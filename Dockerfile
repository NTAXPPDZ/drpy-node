# 构建器阶段
# 使用 node:22-alpine3.22（Node 22 LTS，与 .nvmrc / engines 保持一致）
FROM node:22-alpine3.22 AS builder

# 安装原生模块编译所需工具（node-pty 需要 python3/make/g++）
RUN apk add --no-cache make python3 py3-pip build-base

# 创建一个工作目录
WORKDIR /app

# 先只复制依赖清单，命中 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 复制仓库源码（.dockerignore 已排除 node_modules 与各子项目）
COPY . .

# 复制工作目录中的所有文件到一个临时目录中
# 以便在运行器阶段中使用
RUN mkdir -p /tmp/drpys && \
    cp -r /app/. /tmp/drpys/


# 运行器阶段
# 使用 alpine:3.22 固定基础镜像，与构建器的 Node 主版本保持一致
# （node-pty 是原生模块，Node ABI 必须匹配，否则终端功能不可用）
FROM alpine:3.22 AS runner

# 创建一个工作目录
WORKDIR /app

# 复制构建器阶段中准备好的文件和依赖项到运行器阶段的工作目录中
COPY --from=builder /tmp/drpys/. /app
RUN cp /app/.env.development /app/.env && \
    rm -f /app/.env.development && \
    sed -i 's|^VIRTUAL_ENV[[:space:]]*=[[:space:]]*$|VIRTUAL_ENV=/app/.venv|' /app/.env && \
    sed -i 's|^ENABLE_TERMINAL=0|ENABLE_TERMINAL=1|' /app/.env && \
    echo '{"ali_token":"","ali_refresh_token":"","quark_cookie":"","uc_cookie":"","bili_cookie":"","thread":"10","enable_dr2":"1","enable_py":"2"}' > /app/config/env.json

# 安装 Node.js 运行时（alpine:3.22 提供 22.x，与构建器 ABI 一致）
RUN apk add --no-cache nodejs

# 安装 php8.3 及其扩展
# 注意：php83-cli 由 php83 提供、php83-json 由 php83-common 提供，不能单独安装
RUN apk add --no-cache \
    php83 \
    php83-curl \
    php83-mbstring \
    php83-xml \
    php83-pdo \
    php83-pdo_mysql \
    php83-pdo_sqlite \
    php83-openssl \
    php83-sqlite3
RUN ln -sf /usr/bin/php83 /usr/bin/php

# 安装python3依赖
RUN apk add --no-cache python3 \
    py3-pip \
    py3-setuptools \
    py3-wheel

# 激活python3虚拟环境并安装requirements依赖
RUN python3 -m venv /app/.venv && \
    . /app/.venv/bin/activate && \
    pip3 install -r /app/spider/py/base/requirements.txt

# 暴露应用程序端口（根据您的项目需求调整）
EXPOSE 5757

# 指定容器启动时执行的命令
CMD ["node", "index.js"]
