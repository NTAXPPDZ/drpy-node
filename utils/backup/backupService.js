/**
 * 备份/恢复的唯一服务层（P2-02）。
 *
 * 之前 controllers/web.js（/admin/backup*）与 controllers/admin/backupController.js
 * （/api/admin/backup/*）各自实现了一套复制/恢复/配置逻辑。现在两者都只做
 * 路由适配：参数校验、HTTP 状态码与响应文案由路由决定，业务逻辑全部在这里。
 */
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readJson, writeTextAtomic } from '../config/configRepository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT_DIR = path.resolve(__dirname, '../../');

export const BACKUP_PATHS = Object.freeze([
    '.env',
    '.plugins.js',
    'config/env.json',
    'config/map.txt',
    'config/parses.conf',
    'config/player.json',
    'scripts/cron',
    'plugins',
]);

export const BACKINFO_FILENAME = '.backinfo';

/** 备份目录固定为 <项目父目录>/<项目名>-backup，与历史行为保持一致。 */
export function getBackupRootDir(projectRoot = PROJECT_ROOT_DIR) {
    return path.join(path.dirname(projectRoot), path.basename(projectRoot) + '-backup');
}

export class BackupError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'BackupError';
        this.code = code;
    }
}

async function loadBackinfo(backupDir) {
    return readJson(path.join(backupDir, BACKINFO_FILENAME), null);
}

async function saveBackinfo(backupDir, data) {
    await writeTextAtomic(path.join(backupDir, BACKINFO_FILENAME), JSON.stringify(data, null, 2));
}

/** 有自定义 paths 时使用自定义列表，否则回退默认列表。 */
export async function getEffectiveBackupPaths(backupDir) {
    const info = await loadBackinfo(backupDir);
    if (info && Array.isArray(info.paths) && info.paths.length > 0) {
        return { paths: info.paths, info };
    }
    return { paths: [...BACKUP_PATHS], info };
}

export async function getBackupConfig(projectRoot = PROJECT_ROOT_DIR) {
    const backupDir = getBackupRootDir(projectRoot);
    if (!fs.existsSync(backupDir)) {
        return { paths: [...BACKUP_PATHS], lastBackupAt: null, lastRestoreAt: null };
    }
    const { paths, info } = await getEffectiveBackupPaths(backupDir);
    return {
        paths,
        lastBackupAt: info?.lastBackupAt || null,
        lastRestoreAt: info?.lastRestoreAt || null,
    };
}

export async function updateBackupPaths(paths, projectRoot = PROJECT_ROOT_DIR) {
    if (!Array.isArray(paths)) {
        throw new BackupError('INVALID_PARAM', 'paths must be an array');
    }
    const backupDir = getBackupRootDir(projectRoot);
    await fsp.mkdir(backupDir, { recursive: true });
    const info = (await loadBackinfo(backupDir)) || {};
    await saveBackinfo(backupDir, { ...info, paths });
    return paths;
}

export async function resetBackupPaths(projectRoot = PROJECT_ROOT_DIR) {
    const backupDir = getBackupRootDir(projectRoot);
    await fsp.mkdir(backupDir, { recursive: true });
    const info = (await loadBackinfo(backupDir)) || {};
    await saveBackinfo(backupDir, { ...info, paths: [...BACKUP_PATHS] });
    return [...BACKUP_PATHS];
}

/** 复制一个条目（文件或目录）；不存在返回 false。 */
async function copyEntry(src, dest) {
    if (!fs.existsSync(src)) return false;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
    return true;
}

export async function createBackup(projectRoot = PROJECT_ROOT_DIR) {
    const backupDir = getBackupRootDir(projectRoot);
    await fsp.mkdir(backupDir, { recursive: true });
    const { paths, info } = await getEffectiveBackupPaths(backupDir);
    const details = [];
    for (const item of paths) {
        const copied = await copyEntry(path.join(projectRoot, item), path.join(backupDir, item));
        details.push(copied ? `Backed up: ${item}` : `Skipped (not found): ${item}`);
    }
    const customPaths = info && Array.isArray(info.paths) && info.paths.length > 0 ? info.paths : [];
    await saveBackinfo(backupDir, {
        paths: customPaths,
        lastBackupAt: new Date().toISOString(),
        lastRestoreAt: info?.lastRestoreAt || null,
    });
    return { backupDir, details };
}

export async function restoreBackup(projectRoot = PROJECT_ROOT_DIR) {
    const backupDir = getBackupRootDir(projectRoot);
    if (!fs.existsSync(backupDir)) {
        throw new BackupError('BACKUP_NOT_FOUND', 'Backup directory not found');
    }
    const { paths, info } = await getEffectiveBackupPaths(backupDir);
    const details = [];
    for (const item of paths) {
        const copied = await copyEntry(path.join(backupDir, item), path.join(projectRoot, item));
        details.push(copied ? `Restored: ${item}` : `Skipped (not found in backup): ${item}`);
    }
    const customPaths = info && Array.isArray(info.paths) && info.paths.length > 0 ? info.paths : [];
    await saveBackinfo(backupDir, {
        paths: customPaths,
        lastBackupAt: info?.lastBackupAt || null,
        lastRestoreAt: new Date().toISOString(),
    });
    return { backupDir, details };
}

export default {
    BACKUP_PATHS,
    getBackupRootDir,
    getBackupConfig,
    updateBackupPaths,
    resetBackupPaths,
    createBackup,
    restoreBackup,
};
