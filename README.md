# Expedição Pro — Pedido Manual (MVP)

## O que é
MVP para **montar pedido manual** e **conferir separação** com scanner (SKU/EAN + Enter), usando base de produtos importada via **CSV do Bling**.

## Como rodar
1) Backend
```bash
cd backend
cp .env.example .env
# coloque o arquivo do Firebase Admin SDK em: backend/keys/firebase-service-account.json
npm i
npm run dev
