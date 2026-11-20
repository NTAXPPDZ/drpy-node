/**
 * 轻量 Prometheus 指标（P2-05）。无新增依赖，仅维护内存计数与直方图。
 *
 * 指标：
 *   drpy_http_requests_total{method,route,status}                 counter
 *   drpy_http_request_duration_seconds{method,route}              histogram（P95 用 histogram_quantile(0.95, ...) 计算）
 *   drpy_upstream_requests_total{target,outcome}                  counter   outcome = ok|http_error|error|timeout
 *   drpy_upstream_duration_seconds{target}                        histogram
 *
 * 基数控制：每个指标最多 MAX_SERIES 条时间序列，超出的标签组合合并到 {其余} 。
 * route 使用 Fastify 路由模板（如 /api/:module），未匹配路由统一为 "unmatched"，避免 URL 参数撑爆基数。
 */

export const MAX_SERIES = 500;
export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const OVERFLOW_KEY = '\u0000overflow';

function escapeLabel(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(names, values) {
    if (!names.length) return '';
    const parts = names.map((name, i) => `${name}="${escapeLabel(values[i])}"`);
    return `{${parts.join(',')}}`;
}

class Metric {
    constructor(name, help, type, labelNames) {
        this.name = name;
        this.help = help;
        this.type = type;
        this.labelNames = labelNames;
        this.series = new Map();
    }

    _slot(labelValues) {
        const key = labelValues.join('\u0001');
        if (this.series.has(key)) return { key, labelValues };
        if (this.series.size >= MAX_SERIES) {
            return { key: OVERFLOW_KEY, labelValues: this.labelNames.map(() => '其余') };
        }
        return { key, labelValues };
    }

    _header(lines) {
        lines.push(`# HELP ${this.name} ${this.help}`);
        lines.push(`# TYPE ${this.name} ${this.type}`);
    }
}

export class Counter extends Metric {
    constructor(name, help, labelNames = []) {
        super(name, help, 'counter', labelNames);
    }

    inc(labelValues = [], amount = 1) {
        const slot = this._slot(labelValues);
        const entry = this.series.get(slot.key) || { labelValues: slot.labelValues, value: 0 };
        entry.value += amount;
        this.series.set(slot.key, entry);
    }

    render(lines) {
        this._header(lines);
        for (const entry of this.series.values()) {
            lines.push(`${this.name}${renderLabels(this.labelNames, entry.labelValues)} ${entry.value}`);
        }
    }
}

export class Histogram extends Metric {
    constructor(name, help, labelNames = [], buckets = DURATION_BUCKETS) {
        super(name, help, 'histogram', labelNames);
        this.buckets = [...buckets].sort((a, b) => a - b);
    }

    observe(labelValues = [], value) {
        const slot = this._slot(labelValues);
        let entry = this.series.get(slot.key);
        if (!entry) {
            entry = {
                labelValues: slot.labelValues,
                counts: this.buckets.map(() => 0),
                sum: 0,
                count: 0,
            };
            this.series.set(slot.key, entry);
        }
        entry.sum += value;
        entry.count += 1;
        for (let i = 0; i < this.buckets.length; i += 1) {
            if (value <= this.buckets[i]) entry.counts[i] += 1;
        }
    }

    render(lines) {
        this._header(lines);
        for (const entry of this.series.values()) {
            this.buckets.forEach((le, i) => {
                const labels = renderLabels([...this.labelNames, 'le'], [...entry.labelValues, String(le)]);
                lines.push(`${this.name}_bucket${labels} ${entry.counts[i]}`);
            });
            const infLabels = renderLabels([...this.labelNames, 'le'], [...entry.labelValues, '+Inf']);
            lines.push(`${this.name}_bucket${infLabels} ${entry.count}`);
            const base = renderLabels(this.labelNames, entry.labelValues);
            lines.push(`${this.name}_sum${base} ${entry.sum}`);
            lines.push(`${this.name}_count${base} ${entry.count}`);
        }
    }
}

export const httpRequestsTotal = new Counter(
    'drpy_http_requests_total',
    'HTTP 请求总数',
    ['method', 'route', 'status'],
);

export const httpRequestDuration = new Histogram(
    'drpy_http_request_duration_seconds',
    'HTTP 请求耗时（秒）',
    ['method', 'route'],
);

export const upstreamRequestsTotal = new Counter(
    'drpy_upstream_requests_total',
    '上游请求总数（按目标与结果）',
    ['target', 'outcome'],
);

export const upstreamDuration = new Histogram(
    'drpy_upstream_duration_seconds',
    '上游请求耗时（秒）',
    ['target'],
);

/** 规范化路由标签：未匹配路由统一为 unmatched。 */
export function routeLabel(request) {
    const template = request.routeOptions && request.routeOptions.url;
    return template || 'unmatched';
}

/** 记录一次上游请求。 */
export function observeUpstream(target, outcome, seconds) {
    const label = String(target || 'unknown');
    upstreamRequestsTotal.inc([label, outcome]);
    upstreamDuration.observe([label], Math.max(0, seconds));
}

/** 渲染所有指标为 Prometheus 文本。 */
export function renderMetrics() {
    const lines = [];
    httpRequestsTotal.render(lines);
    httpRequestDuration.render(lines);
    upstreamRequestsTotal.render(lines);
    upstreamDuration.render(lines);
    return lines.join('\n') + '\n';
}

/** 注册 Fastify 钩子：记录每个请求的方法/路由/状态码/耗时。 */
export function registerMetricsHooks(fastify) {
    fastify.addHook('onRequest', (request, reply, done) => {
        request.__metricsStart = process.hrtime.bigint();
        done();
    });
    fastify.addHook('onResponse', (request, reply, done) => {
        try {
            const start = request.__metricsStart;
            const seconds = start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
            const method = request.method || 'UNKNOWN';
            const route = routeLabel(request);
            httpRequestsTotal.inc([method, route, String(reply.statusCode)]);
            httpRequestDuration.observe([method, route], seconds);
        } catch {
            // 指标失败不能影响响应
        }
        done();
    });
}

export function resetMetricsForTest() {
    for (const metric of [httpRequestsTotal, httpRequestDuration, upstreamRequestsTotal, upstreamDuration]) {
        metric.series.clear();
    }
}

export default { renderMetrics, registerMetricsHooks, observeUpstream, routeLabel };
