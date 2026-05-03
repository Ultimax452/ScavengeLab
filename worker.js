{
  "name": "scavenge-assistant",
  "version": "0.8.0",
  "private": true,
  "type": "module",
  "scripts": {
    "cf:login": "wrangler login",
    "cf:db:create": "wrangler d1 create scavenge-assistant",
    "cf:db:schema": "wrangler d1 execute scavenge-assistant --file=backend/schema.sql --remote",
    "cf:deploy": "wrangler deploy",
    "check": "node --check backend/worker.js && node --check userscript/scavenge-assistant.user.js"
  },
  "devDependencies": {
    "wrangler": "^4.0.0"
  }
}
