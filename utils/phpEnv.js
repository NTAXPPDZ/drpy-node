import { execFile } from 'child_process';
import { promisify } from 'util';
import { prepareBinary } from './binHelper.js';
import {createLogger as __createLogger} from './logger.js';
const _log = __createLogger('utils/phpEnv');

const execFileAsync = promisify(execFile);

export let isPhpAvailable = false;
export let phpVersion = '';

export const checkPhpAvailable = async () => {
    let phpPath = process.env.PHP_PATH || 'php';
    
    // Check existence and permissions
    const validPath = prepareBinary(phpPath);
    if (!validPath) {
        _log.warn(`⚠️ PHP binary not found or invalid: ${phpPath}`);
        isPhpAvailable = false;
        phpVersion = '';
        return false;
    }
    phpPath = validPath;

    try {
        _log.info(`[phpEnv] Verifying PHP executable: ${phpPath}`);
        const { stdout } = await execFileAsync(phpPath, ['-v']);
        const match = stdout.match(/PHP\s+([0-9.]+)/i);
        phpVersion = match ? match[1] : 'ON';
        isPhpAvailable = true;
        _log.info(`✅ PHP environment check passed (${phpPath}, v${phpVersion}).`);
    } catch (e) {
        isPhpAvailable = false;
        phpVersion = '';
        _log.warn(`⚠️ PHP environment check failed. PHP features will be disabled.`);
        _log.warn(`[phpEnv] Error details:`, e.message);
        // _log.error(e);
    }
    return isPhpAvailable;
};
