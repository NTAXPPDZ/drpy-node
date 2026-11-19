/**
 * 文件管理控制器
 * 提供文件列表、读取、写入、删除功能
 * 所有路径统一走 utils/security/pathGuard.js 的 resolveInside，拒绝 ../、绝对路径、符号链接逃逸
 */

import fs from '../../utils/fsWrapper.js';
import path from 'path';
import mime from 'mime-types';
import { PROJECT_ROOT } from '../../utils/pathHelper.js';
import { resolveInside, PathSecurityError } from '../../utils/security/pathGuard.js';

// 敏感路径黑名单：命中任一关键词即拒绝
const PATH_BLACKLIST = [
    'node_modules',
    'database.db',
    '.git',
    '.env',
    'package-lock.json',
    'yarn.lock'
];

/**
 * 解析并校验用户提交的相对路径
 * @param {string} input 用户输入
 * @returns {string} 绝对路径
 * @throws {PathSecurityError}
 */
function resolveUserPath(input) {
    const fullPath = resolveInside(PROJECT_ROOT, input, { allowRoot: true });
    const relativePath = path.relative(PROJECT_ROOT, fullPath);
    if (PATH_BLACKLIST.some(item => relativePath.includes(item))) {
        throw new PathSecurityError('PATH_FORBIDDEN', '禁止访问：' + relativePath, 403);
    }
    return fullPath;
}

/**
 * 统一错误响应
 */
function replyError(reply, error, fallbackMessage) {
    if (error instanceof PathSecurityError) {
        return reply.code(error.statusCode || 403).send({ error: error.message, code: error.code });
    }
    return reply.code(500).send({ error: fallbackMessage });
}

// 列出目录
export async function listDirectory(req, reply) {
    try {
        const dirPath = req.query.path || '.';
        const fullPath = resolveUserPath(dirPath);

        const files = await fs.readdir(fullPath, { withFileTypes: true });

        const result = files.map(f => {
            const isDir = f.isDirectory();
            return {
                name: f.name,
                path: dirPath === '.' ? f.name : dirPath + '/' + f.name,
                isDirectory: isDir,
                size: isDir ? undefined : 0
            };
        });

        for (let i = 0; i < result.length; i++) {
            if (!result[i].isDirectory) {
                try {
                    const stat = await fs.stat(path.join(fullPath, result[i].name));
                    result[i].size = stat.size;
                } catch {
                    // 忽略单个文件的 stat 失败
                }
            }
        }

        return reply.send({ files: result });
    } catch (e) {
        return replyError(reply, e, '读取目录失败');
    }
}

// 读取文件
export async function readFile(req, reply) {
    try {
        const { path: filePath } = req.query;

        if (!filePath) {
            return reply.code(400).send({ error: '缺少文件路径', code: 'INVALID_PARAM' });
        }

        const fullPath = resolveUserPath(filePath);

        if (!await fs.pathExists(fullPath)) {
            return reply.code(404).send({ error: '文件不存在', code: 'NOT_FOUND' });
        }

        const ext = path.extname(filePath).toLowerCase();
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.tif'];

        if (imageExts.includes(ext)) {
            const buffer = await fs.readFile(fullPath);
            const base64 = buffer.toString('base64');
            const mimeType = mime.lookup(fullPath) || 'image/png';

            return reply.send({
                type: 'image',
                mimeType,
                dataUrl: 'data:' + mimeType + ';base64,' + base64
            });
        }

        let content = await fs.readFile(fullPath, 'utf-8');

        if (ext === '.js') {
            try {
                const { decodeDsSource } = await import('../../utils/dsHelper.js');
                content = await decodeDsSource(content);
            } catch {
                // 解码失败保持原样
            }
        }

        return reply.send({ type: 'text', content });
    } catch (e) {
        return replyError(reply, e, '读取文件失败');
    }
}

// 写入文件
export async function writeFile(req, reply) {
    try {
        if (process.env.READ_ONLY_MODE === '1') {
            return reply.code(403).send({ error: '系统当前处于只读模式，禁止修改文件', code: 'READ_ONLY' });
        }

        const { path: filePath, content } = req.body;

        if (!filePath) {
            return reply.code(400).send({ error: '缺少文件路径', code: 'INVALID_PARAM' });
        }

        const fullPath = resolveUserPath(filePath);

        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content, 'utf-8');

        return reply.send({ success: true, message: '文件保存成功' });
    } catch (e) {
        return replyError(reply, e, '写入文件失败');
    }
}

// 删除文件
export async function deleteFile(req, reply) {
    try {
        if (process.env.READ_ONLY_MODE === '1') {
            return reply.code(403).send({ error: '系统当前处于只读模式，禁止删除文件', code: 'READ_ONLY' });
        }

        const { path: filePath } = req.query;
        const fp = filePath || (req.body && req.body.path);

        if (!fp) {
            return reply.code(400).send({ error: '缺少文件路径', code: 'INVALID_PARAM' });
        }

        const fullPath = resolveUserPath(fp);

        if (!await fs.pathExists(fullPath)) {
            return reply.code(404).send({ error: '文件不存在', code: 'NOT_FOUND' });
        }

        await fs.remove(fullPath);

        return reply.send({ success: true, message: '文件删除成功' });
    } catch (e) {
        return replyError(reply, e, '删除文件失败');
    }
}
