/**
 * Path guard for user-controlled file names and module names.
 *
 * The helpers in this module are intentionally synchronous because the main
 * call sites (module lookup / static file handling) are synchronous. They
 * perform lexical containment checks plus a realpath check so that existing
 * symlinks cannot escape the configured root.
 */
import path from 'node:path';
import {lstatSync, realpathSync} from 'node:fs';

const MAX_PATH_LENGTH = 4096;
const MAX_MODULE_NAME_BYTES = 255;
const ALLOWED_MODULE_EXTENSIONS = new Set(['.js', '.py', '.php', '.json']);
const WINDOWS_INVALID_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/;

export class PathSecurityError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = 'PathSecurityError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function decodeForValidation(input) {
    let value = input;
    // Decode at most twice so that double-encoded traversal is still visible.
    for (let i = 0; i < 2; i++) {
        if (!/%[0-9a-fA-F]{2}/.test(value)) break;
        try {
            const decoded = decodeURIComponent(value);
            if (decoded === value) break;
            value = decoded;
        } catch {
            // Malformed percent escapes are treated as literal file name text.
            // They cannot by themselves create a path separator.
            break;
        }
    }
    return value;
}

function isAbsoluteLike(value) {
    return path.isAbsolute(value)
        || path.win32.isAbsolute(value)
        || /^[a-zA-Z]:/.test(value);
}

function hasTraversalSegment(value) {
    return value
        .replace(/\\/g, '/')
        .split('/')
        .some(segment => segment === '..' || /^\.\.[ .]*$/.test(segment));
}

function assertSafePathInput(input, {allowEmpty = false} = {}) {
    if (typeof input !== 'string') {
        throw new PathSecurityError('INVALID_PATH', 'Path must be a string', 400);
    }
    if (input.length > MAX_PATH_LENGTH) {
        throw new PathSecurityError('INVALID_PATH', 'Path is too long', 400);
    }
    if (input.includes('\0')) {
        throw new PathSecurityError('INVALID_PATH', 'Path contains a null byte', 400);
    }
    if (input.length === 0) {
        if (allowEmpty) return;
        throw new PathSecurityError('INVALID_PATH', 'Path must not be empty', 400);
    }

    const candidates = new Set([input, decodeForValidation(input)]);
    for (const candidate of candidates) {
        if (candidate.includes('\0')) {
            throw new PathSecurityError('INVALID_PATH', 'Path contains a null byte', 400);
        }
        if (isAbsoluteLike(candidate)) {
            throw new PathSecurityError('ABSOLUTE_PATH', 'Absolute paths are not allowed', 400);
        }
        if (hasTraversalSegment(candidate)) {
            throw new PathSecurityError('PATH_TRAVERSAL', 'Path traversal is not allowed', 400);
        }
    }
}

/**
 * Lexical containment check. This does not resolve symlinks; resolveInside()
 * adds the realpath checks required for filesystem access.
 */
export function isPathInside(root, target) {
    const rootResolved = path.resolve(root);
    const targetResolved = path.resolve(target);
    const relative = path.relative(rootResolved, targetResolved);
    return relative === ''
        || (relative !== '..'
            && !relative.startsWith(`..${path.sep}`)
            && !path.isAbsolute(relative));
}

function assertInside(rootReal, targetReal, code = 'PATH_OUTSIDE_ROOT') {
    const relative = path.relative(rootReal, targetReal);
    if (relative === '') return;
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new PathSecurityError(code, 'Path escapes the allowed root', 403);
    }
}

function getRootRealPath(root) {
    if (typeof root !== 'string' || root.length === 0) {
        throw new PathSecurityError('INVALID_ROOT', 'Root directory is required', 500);
    }
    const rootResolved = path.resolve(root);
    try {
        return realpathSync.native(rootResolved);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new PathSecurityError('INVALID_ROOT', 'Root directory does not exist', 500);
        }
        throw new PathSecurityError('INVALID_ROOT', `Unable to resolve root directory: ${error.message}`, 500);
    }
}

function resolveTargetPath(rootReal, target) {
    // Check the target first. This catches existing symlinks (including links
    // that resolve outside the root) and broken symlinks.
    let cursor = target;
    while (true) {
        let stat;
        try {
            stat = lstatSync(cursor);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new PathSecurityError('PATH_RESOLUTION_FAILED', `Unable to inspect path: ${error.message}`, 500);
            }
        }

        if (stat) {
            let real;
            try {
                real = realpathSync.native(cursor);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    throw new PathSecurityError('BROKEN_SYMLINK', 'Broken symlinks are not allowed', 403);
                }
                throw new PathSecurityError('PATH_RESOLUTION_FAILED', `Unable to resolve path: ${error.message}`, 500);
            }
            assertInside(rootReal, real, 'SYMLINK_ESCAPE');
            // Existing targets are returned via their real path. Missing write
            // targets are returned as the guarded candidate path.
            return cursor === target ? real : target;
        }

        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
    }

    throw new PathSecurityError('PATH_RESOLUTION_FAILED', 'Unable to resolve path root', 500);
}

/**
 * Resolve a user-controlled path inside root.
 *
 * Rules:
 * - absolute paths, null bytes and `..` segments are rejected;
 * - percent-encoded traversal is rejected (double encoding included);
 * - lexical containment uses path.relative(), not startsWith();
 * - existing targets, and the nearest existing parent of write targets, are
 *   checked with realpath so symlinks cannot escape root.
 *
 * @param {string} root trusted root directory
 * @param {string} input user-controlled path relative to root
 * @param {{allowRoot?: boolean}} [options]
 * @returns {string} safe absolute path
 */
export function resolveInside(root, input, options = {}) {
    const allowRoot = options.allowRoot === true;
    assertSafePathInput(input, {allowEmpty: allowRoot});

    const rootReal = getRootRealPath(root);
    if (input.length === 0) return rootReal;

    const target = path.resolve(rootReal, input);
    if (!allowRoot && target === rootReal) {
        throw new PathSecurityError('INVALID_PATH', 'A file path is required', 400);
    }
    assertInside(rootReal, target);
    return resolveTargetPath(rootReal, target);
}

/**
 * Validate a module name. Module names are a single file name (no directory
 * separators), may contain Unicode and spaces, and may not contain characters
 * that Windows treats as path syntax.
 */
export function assertSafeModuleName(moduleName) {
    assertSafePathInput(moduleName);
    if (moduleName === '.' || moduleName === '..') {
        throw new PathSecurityError('INVALID_MODULE_NAME', 'Invalid module name', 400);
    }
    if (/[\\/]/.test(moduleName)) {
        throw new PathSecurityError('INVALID_MODULE_NAME', 'Module name must not contain path separators', 400);
    }
    if (WINDOWS_INVALID_NAME_CHARS.test(moduleName)) {
        throw new PathSecurityError('INVALID_MODULE_NAME', 'Module name contains unsupported characters', 400);
    }
    if (/[. ]$/.test(moduleName)) {
        throw new PathSecurityError('INVALID_MODULE_NAME', 'Module name must not end with a dot or space', 400);
    }
    if (Buffer.byteLength(moduleName, 'utf8') > MAX_MODULE_NAME_BYTES) {
        throw new PathSecurityError('INVALID_MODULE_NAME', 'Module name is too long', 400);
    }

    return moduleName;
}

/**
 * Resolve a source module file with a code-controlled extension.
 *
 * @param {string} root module directory
 * @param {string} moduleName user-controlled module name
 * @param {string} extension extension selected by the adapter switch
 * @returns {string} safe module file path
 */
export function resolveModulePath(root, moduleName, extension) {
    assertSafeModuleName(moduleName);
    if (typeof extension !== 'string' || !ALLOWED_MODULE_EXTENSIONS.has(extension)) {
        throw new PathSecurityError('INVALID_MODULE_EXTENSION', 'Unsupported module extension', 400);
    }
    return resolveInside(root, `${moduleName}${extension}`);
}

export {ALLOWED_MODULE_EXTENSIONS};
