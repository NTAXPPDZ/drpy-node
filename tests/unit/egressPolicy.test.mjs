import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';

import {
    EgressPolicyError,
    assertAllowedAddress,
    resolveAndCheck,
    assertPublicUrl,
} from '../../utils/security/egressPolicy.js';

describe('assertAllowedAddress（strict）', () => {
    const blocked = [
        '127.0.0.1',
        '10.1.2.3',
        '172.16.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '224.0.0.1',
        '255.255.255.255',
        '::1',
        '::',
        'fe80::1',
        'fc00::1',
        'fd00:ec2::254',
        '::ffff:127.0.0.1',
    ];

    for (const address of blocked) {
        test('拒绝 ' + address, () => {
            assert.throws(() => assertAllowedAddress(address, { mode: 'strict' }), EgressPolicyError);
        });
    }

    test('允许公网 IPv4', () => {
        assert.doesNotThrow(() => assertAllowedAddress('1.1.1.1', { mode: 'strict' }));
        assert.doesNotThrow(() => assertAllowedAddress('8.8.8.8', { mode: 'strict' }));
    });

    test('允许公网 IPv6', () => {
        assert.doesNotThrow(() => assertAllowedAddress('2606:4700:4700::1111', { mode: 'strict' }));
    });

    test('Clash fake-IP 段视为公网', () => {
        assert.doesNotThrow(() => assertAllowedAddress('198.18.0.5', { mode: 'strict' }));
    });
});

describe('assertAllowedAddress（metadata 模式）', () => {
    test('允许内网', () => {
        assert.doesNotThrow(() => assertAllowedAddress('192.168.1.10', { mode: 'metadata' }));
        assert.doesNotThrow(() => assertAllowedAddress('10.0.0.8', { mode: 'metadata' }));
    });

    test('仍拒绝回环', () => {
        assert.throws(() => assertAllowedAddress('127.0.0.1', { mode: 'metadata' }), EgressPolicyError);
        assert.throws(() => assertAllowedAddress('::1', { mode: 'metadata' }), EgressPolicyError);
    });

    test('任何模式都拒绝元数据地址', () => {
        assert.throws(() => assertAllowedAddress('169.254.169.254', { mode: 'metadata' }), EgressPolicyError);
        assert.throws(() => assertAllowedAddress('fd00:ec2::254', { mode: 'metadata' }), EgressPolicyError);
    });
});

describe('assertAllowedAddress（lan 模式，播放链路默认）', () => {
    test('允许内网与回环，兼容自建媒体源/本地播放代理', () => {
        assert.doesNotThrow(() => assertAllowedAddress('192.168.1.10', { mode: 'lan' }));
        assert.doesNotThrow(() => assertAllowedAddress('10.0.0.8', { mode: 'lan' }));
        assert.doesNotThrow(() => assertAllowedAddress('127.0.0.1', { mode: 'lan' }));
        assert.doesNotThrow(() => assertAllowedAddress('::1', { mode: 'lan' }));
    });

    test('仍拒绝元数据地址', () => {
        assert.throws(() => assertAllowedAddress('169.254.169.254', { mode: 'lan' }), EgressPolicyError);
        assert.throws(() => assertAllowedAddress('100.100.100.200', { mode: 'lan' }), EgressPolicyError);
    });
});
describe('resolveAndCheck', () => {
    test('域名解析后命中内网被拒', async () => {
        const fakeResolve = async () => [{ address: '10.0.0.5', family: 4 }];
        await assert.rejects(() => resolveAndCheck('internal.example.com', { mode: 'strict', resolve: fakeResolve }), EgressPolicyError);
    });

    test('全部地址公网时放行', async () => {
        const fakeResolve = async () => [
            { address: '1.1.1.1', family: 4 },
            { address: '2606:4700:4700::1111', family: 6 },
        ];
        const result = await resolveAndCheck('example.com', { mode: 'strict', resolve: fakeResolve });
        assert.equal(result.length, 2);
    });

    test('解析为空被拒', async () => {
        const fakeResolve = async () => [];
        await assert.rejects(() => resolveAndCheck('nothing.example.com', { mode: 'strict', resolve: fakeResolve }), EgressPolicyError);
    });

    test('真实解析公网域名（离线则跳过）', async () => {
        try {
            const result = await resolveAndCheck('example.com', { mode: 'strict', resolve: dns.lookup.bind(dns) });
            assert.ok(Array.isArray(result));
        } catch (error) {
            if (error instanceof EgressPolicyError) throw error;
            // DNS 不可用时不阻塞测试
        }
    });
});

describe('assertPublicUrl', () => {
    test('非 http(s) 协议被拒', async () => {
        await assert.rejects(() => assertPublicUrl('file:///etc/passwd', { mode: 'strict' }), EgressPolicyError);
        await assert.rejects(() => assertPublicUrl('ftp://example.com/a', { mode: 'strict' }), EgressPolicyError);
        await assert.rejects(() => assertPublicUrl('gopher://example.com/a', { mode: 'strict' }), EgressPolicyError);
    });

    test('非法 URL 被拒', async () => {
        await assert.rejects(() => assertPublicUrl('not a url', { mode: 'strict' }), EgressPolicyError);
    });

    test('IP 直连内网被拒', async () => {
        await assert.rejects(() => assertPublicUrl('http://127.0.0.1:8080/a', { mode: 'strict' }), EgressPolicyError);
        await assert.rejects(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/', { mode: 'strict' }), EgressPolicyError);
        await assert.rejects(() => assertPublicUrl('http://[::1]:9000/a', { mode: 'strict' }), EgressPolicyError);
    });

    test('十进制/十六进制 IP 归一后仍被拒', async () => {
        await assert.rejects(() => assertPublicUrl('http://2130706433/a', { mode: 'strict' }), EgressPolicyError);
        await assert.rejects(() => assertPublicUrl('http://0x7f000001/a', { mode: 'strict' }), EgressPolicyError);
    });

    test('metadata 主机名被拒', async () => {
        await assert.rejects(() => assertPublicUrl('http://metadata.google.internal/computeMetadata/v1/', { mode: 'strict' }), EgressPolicyError);
    });

    test('公网 IP 直连放行', async () => {
        const result = await assertPublicUrl('https://1.1.1.1/a', { mode: 'strict' });
        assert.equal(result.protocol, 'https:');
    });
});
