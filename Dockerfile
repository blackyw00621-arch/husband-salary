FROM alpine:latest

# 安裝所需套件 (unzip, ca-certificates, curl)
RUN apk add --no-cache unzip ca-certificates curl

# 下載並解壓縮 PocketBase v0.39.4
ADD https://github.com/pocketbase/pocketbase/releases/download/v0.39.4/pocketbase_0.39.4_linux_amd64.zip /tmp/pocketbase.zip
RUN unzip /tmp/pocketbase.zip -d /app && chmod +x /app/pocketbase && rm /tmp/pocketbase.zip

# 設定工作目錄為 /app
WORKDIR /app

# 複製本機的資料庫結構遷移腳本到容器中
COPY ./pb_migrations /app/pb_migrations

# 暴露內部的 8080 連接埠 (Fly.io 預設埠)
EXPOSE 8080

# 啟動 PocketBase 服務，並將資料庫與遷移路徑指向正確路徑
CMD ["/app/pocketbase", "serve", "--http=0.0.0.0:8080", "--dir=/pb_data", "--migrationsDir=/app/pb_migrations"]
