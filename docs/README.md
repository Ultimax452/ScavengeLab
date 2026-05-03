# Dokumentace

## Cile projektu

Scavenge Assistant je navrzeny jako informacni a planovaci panel pro sber surovin.
Neni to bot a nema hrat misto hrace.

Hlavni cile:

- lepsi prehled o vynosu za hodinu,
- rozumne rozdeleni jednotek podle dostupne armady,
- porovnani aktivnich a AFK scenaru,
- mereni presnosti predikce proti realnym vysledkum,
- anonymni dataset pro pozdejsi ladeni vypoctu.

## Bezpecnostni hranice

- Script nikdy neklika na odeslani sberu.
- Script neposila data bez vyslovneho opt-in souhlasu.
- Anonymni payload neobsahuje ID vesnice, souradnice, cookies ani jmeno hrace.
- Odesilani je batchovane, aby nevznikal spam requestu.
- Selhani odeslani je tiche a bez retry smycky.

## Vyvojovy rezim

Zakladni userscript je v:

```text
userscript/scavenge-assistant.user.js
```

Cloudflare Worker MVP endpoint je v:

```text
backend/worker.js
```

Ukazkovy anonymni dataset je v:

```text
data/example-dataset.json
```

## Pred vydanim beta verze

1. Otestovat userscript na vice uctech / stylech hry.
2. Nasbirat dost sparovanych vysledku.
3. Zkontrolovat prumernou odchylku predikce.
4. Nasadit realny Cloudflare endpoint.
5. V userscriptu zmenit `DATA_SHARING_ENDPOINT`.
6. Zkontrolovat, ze README jasne popisuje opt-in sdileni.
