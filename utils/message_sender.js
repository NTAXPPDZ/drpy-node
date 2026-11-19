import axios from 'axios';
import nodemailer from 'nodemailer';
import {createLogger as __createLogger} from './logger.js';
const _log = __createLogger('utils/message_sender');

export default class MessageSender {
    static TYPE = {
        DINGDING: 0,
        WECHAT: 1,
        QQEMAIL: 2,
        // 未来可扩展更多类型...
    };

    /**
     * 发送消息
     * @param {string|object} text 消息文本（字符串或邮件配置对象）
     * @param {number} type 消息类型（0: 钉钉，1: 企业微信，2: QQ邮箱），默认 0
     */
    static async send(text, type = MessageSender.TYPE.DINGDING) {
        if (!text) {
            _log.warn('[MessageSender] 消息内容不能为空');
            return;
        }

        // QQ邮箱只允许对象，其他类型必须为字符串
        if (type === MessageSender.TYPE.QQEMAIL && typeof text !== 'object') {
            _log.warn('[MessageSender] QQ邮箱类型只支持配置对象');
            return;
        }
        
        if (type !== MessageSender.TYPE.QQEMAIL && typeof text !== 'string') {
            _log.warn('[MessageSender] 非邮箱类型消息内容必须是字符串');
            return;
        }

        switch (type) {
            case MessageSender.TYPE.DINGDING:
                await this.#sendDingDing(text);
                break;

            case MessageSender.TYPE.WECHAT:
                await this.#sendWeChat(text);
                break;

            case MessageSender.TYPE.QQEMAIL:
                await this.#sendQQEmail(text);
                break;

            default:
                _log.warn(`[MessageSender] 不支持的消息类型: ${type}`);
        }
    }

    static async #sendDingDing(text) {
        const {dingding_webhook} = process.env;
        if (!dingding_webhook) {
            _log.info('[MessageSender] 未配置 dingding_webhook，跳过钉钉发送');
            return;
        }
        try {
            await axios.post(dingding_webhook, {
                msgtype: 'text',
                text: {content: text}
            });
            _log.info('[MessageSender] 钉钉消息已发送');
        } catch (err) {
            _log.error('[MessageSender] 钉钉消息发送失败:', err.message);
        }
    }

    static async #sendWeChat(text) {
        const {wechat_webhook} = process.env;
        if (!wechat_webhook) {
            _log.info('[MessageSender] 未配置 wechat_webhook，跳过企业微信发送');
            return;
        }
        try {
            await axios.post(wechat_webhook, {
                msgtype: 'text',
                text: {content: text}
            });
            _log.info('[MessageSender] 企业微信消息已发送');
        } catch (err) {
            _log.error('[MessageSender] 企业微信消息发送失败:', err.message);
        }
    }

    /**
     * 发送QQ邮件（支持文本/HTML/多收件人）
     * @param {object} config 邮件配置对象
     * @property {string} [to] 收件人邮箱，默认使用环境变量QQ_EMAIL
     * @property {string} [subject] 邮件主题，默认"系统通知"
     * @property {string} [text] 纯文本内容
     * @property {string} [html] HTML内容
     * @property {Array} [attachments] 邮件附件
     */
    static async #sendQQEmail(config) {
        const {QQ_EMAIL, QQ_SMTP_AUTH_CODE} = process.env;
        
        if (!QQ_EMAIL || !QQ_SMTP_AUTH_CODE) {
            _log.info('[MessageSender] 未配置QQ邮箱或SMTP授权码，跳过邮件发送');
            return;
        }

        // 创建带连接池的邮件传输器
        const transporter = nodemailer.createTransport({
            //pool: true, // 启用连接池
            host: 'smtp.qq.com',
            port: 465,
            secure: true,
            auth: {
                user: QQ_EMAIL,
                pass: QQ_SMTP_AUTH_CODE
            }
        });

        try {
            // 构建邮件选项，保护关键字段并提供默认值
            const mailOptions = {
                from: `"系统通知" <${QQ_EMAIL}>`, // 固定发件人
                to: config.to || QQ_EMAIL, // 允许自定义收件人
                ...config
            };
            
            const info = await transporter.sendMail(mailOptions);
            _log.info('[MessageSender] QQ邮件已发送: %s', info.accepted);
        } catch (err) {
            _log.error('[MessageSender] QQ邮件发送失败:', err.message);
        } finally {
            transporter.close(); // 关闭连接池
        }
    }
}
