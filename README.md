# Checkers player microservice

Zero dependencies, Node >= 20. `npm start` (env: `PORT`, `PUBLIC_URL`, `AI_DEPTH`, `BASE_DELAY_MS`, `ALLOWED_PEERS`, `HOST`); `npm test`.

Run two instances and watch them play:

```
PORT=3001 npm start
PORT=3002 npm start
```

Open http://localhost:3001, choose "New game" with opponent `http://localhost:3002`. Or create a game on one instance and on the other use "Join" with the first's URL and the game id. Use the speed slider (0.1x–20x) and Pause/Resume; each instance paces its own moves, so open both UIs to control both sides. Behind a proxy or non-localhost, set `PUBLIC_URL` so the peer can call back.

API: see `src/server.js` (`/api/games`, `/api/games/join`, `/api/games/:id/{events,speed,pause}`, `/peer/games/:id/{join,moves}`).


**Security:** the API is unauthenticated (anyone who can reach it can create games, change speed, and make the service POST to any http(s) peer URL). It binds to `127.0.0.1` by default; set `HOST=0.0.0.0` only on trusted networks, and set `ALLOWED_PEERS` (comma-separated peer URLs) to restrict outbound calls. Finished games are kept in memory until restart.
