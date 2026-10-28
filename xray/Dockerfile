# Образ сервиса xray (change telegram-proxy-failover): бинарь Xray из
# teddysun/xray + Node-супервизор, который собирает конфиг из VPN-подписки.
# Версия Xray закреплена — с :latest обновление провайдерского образа могло
# бы молча поменять поведение туннеля при очередной пересборке.
FROM teddysun/xray:25.6.8 AS xray

FROM node:20-alpine
COPY --from=xray /usr/bin/xray /usr/bin/xray
WORKDIR /app
COPY subscription.js supervisor.js ./
CMD ["node", "/app/supervisor.js"]
