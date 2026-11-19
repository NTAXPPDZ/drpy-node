import * as backupService from '../../utils/backup/backupService.js';

/**
 * /api/admin/backup/* 的薄适配层：业务逻辑见 utils/backup/backupService.js（P2-02）。
 */

const { BackupError } = backupService;

export const getBackupConfig = async (request, reply) => {
    const data = await backupService.getBackupConfig();
    return reply.send({ success: true, ...data });
};

export const updateBackupConfig = async (request, reply) => {
    try {
        const paths = await backupService.updateBackupPaths(request.body?.paths);
        return reply.send({ success: true, message: 'Backup configuration updated successfully', paths });
    } catch (error) {
        if (error instanceof BackupError) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        request.log.error(`Update backup config failed: ${error.message}`);
        return reply.code(500).send({ success: false, message: 'Update backup config failed: ' + error.message });
    }
};

export const resetBackupConfig = async (request, reply) => {
    try {
        const paths = await backupService.resetBackupPaths();
        return reply.send({ success: true, message: 'Backup configuration reset to defaults', paths });
    } catch (error) {
        request.log.error(`Reset backup config failed: ${error.message}`);
        return reply.code(500).send({ success: false, message: 'Reset backup config failed: ' + error.message });
    }
};

export const createBackup = async (request, reply) => {
    if (process.env.VERCEL) {
        return reply.code(403).send({ success: false, message: 'Vercel environment does not support backup' });
    }
    try {
        const result = await backupService.createBackup();
        return reply.send({ success: true, message: 'Backup completed successfully', ...result });
    } catch (error) {
        request.log.error(`Backup failed: ${error.message}`);
        return reply.code(500).send({ success: false, message: 'Backup failed: ' + error.message });
    }
};

export const restoreBackup = async (request, reply) => {
    if (process.env.VERCEL) {
        return reply.code(403).send({ success: false, message: 'Vercel environment does not support restore' });
    }
    try {
        const result = await backupService.restoreBackup();
        return reply.send({ success: true, message: 'Restore completed successfully', ...result });
    } catch (error) {
        if (error instanceof BackupError && error.code === 'BACKUP_NOT_FOUND') {
            return reply.code(404).send({ success: false, message: 'Backup directory not found' });
        }
        request.log.error(`Restore failed: ${error.message}`);
        return reply.code(500).send({ success: false, message: 'Restore failed: ' + error.message });
    }
};
