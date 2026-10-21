# pacyt-mc-bot

Headless-Minecraft-Bot auf Basis von [mineflayer](https://github.com/PrismarineJS/mineflayer), der sich mit
einem **Microsoft-Konto** (Minecraft Java) auf einem Server anmeldet, die Weltdaten auswertet und optional
eine 3D-Ansicht für Screenshots bereitstellt.

Entstanden für `pacyt.de` (Velocity-Proxy). Läuft ohne Passworteingabe durch den Agenten: der Login
benutzt den offiziellen **Device-Code-Flow**, den der Kontoinhaber selbst im Browser bestätigt.

## Wie der Login funktioniert

1. `prismarine-auth` wird mit `flow: 'live'` und `authTitle: Titles.MinecraftJava` gestartet.
2. Der Device-Code wird über das **vierte Konstruktorargument** (`codeCallback`) ausgegeben — nicht über
   die Options. Wer ihn in den Options erwartet, bekommt `this.codeCallback is not a function`.
3. Microsoft antwortet auf den anschließenden `title.auth.xboxlive.com/title/authenticate`-Schritt mit
   **403 (leerer Body)**. Fix: nach dem Konstruktor `flow.doTitleAuth = false` setzen. Dann läuft die Kette
   nur über User-Token + Device-Token → XSTS → `rp://api.minecraftservices.com/` und funktioniert.
4. Die gepatchte `Authflow`-Klasse muss **vor** `require('mineflayer')` gesetzt werden, weil
   `minecraft-protocol` `Authflow` beim Laden destrukturiert.
5. Tokens landen im Cache-Verzeichnis (`MC_AUTH_CACHE`, Standard `./auth`). **Dieses Verzeichnis niemals
   committen** — es enthält Refresh-Tokens.

Der `msal`-Flow ist derzeit unbrauchbar: Microsoft beantwortet den Device-Code-Request mit
`invalid_grant` (Client hat keine Berechtigung für non-interactive code auth).

## Warum der Bot zusätzlich Pakete selbst sendet

`mineflayer` sendet `player_loaded` nur bei gesetztem `sendsPlayerLoadedPacket`-Feature und
`chunk_batch_received` nur nach `chunk_batch_finished`. Fehlen die Pakete, hält der Server den Client für
„lädt noch“: Kommandos werden ignoriert (Antwort: `Unknown or incomplete command`) und der Client fliegt
raus. Deshalb schickt `src/bot.js` nach dem Spawn einmal `player_loaded` und danach im Takt
`chunk_batch_received`.

Zusätzlich ist der Client-Watchdog abgeschaltet (`checkTimeoutInterval: 180000`) — sonst beendet sich der
Bot nach 30 s selbst, obwohl die Verbindung noch steht.

## Betrieb

```bash
npm install
MC_USER="dein@konto.tld" node src/bot.js        # einmalig: Device-Code im Log, im Browser bestätigen
bash scripts/supervisor.sh                       # Dauerbetrieb: Reconnect nach 3 s
```

Umgebungsvariablen:

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `MC_USER` | Microsoft-Konto (Mail) | — |
| `MC_HOST` / `MC_PORT` | Server | `pacyt.de` / `25565` |
| `MC_VERSION` | Protokollversion für mineflayer | `26.1` |
| `MC_AUTH_CACHE` | Token-Cache | `./auth` |
| `VIEWER_PORT` | 3D-Ansicht auf diesem Port (`0` = aus) | `0` |
| `VIEWER_DISTANCE` | Sichtweite des Renderers in Chunks | `8` |
| `MC_SWITCHES` | kommagetrennte Kommandos nach dem Spawn | — |

## Screenshots ohne Spielclient

`prismarine-viewer` rendert die Welt als Webseite (`http://127.0.0.1:<VIEWER_PORT>/`), die per
Headless-Browser abfotografiert werden kann. Benötigt das native Modul `canvas`:

```bash
npm install-scripts approve canvas && npm rebuild canvas
```

Die Blickrichtung lässt sich ohne Neustart über `control.json` setzen (`{"yaw":1.9,"pitch":-0.15}`),
die der Bot im Sekundentakt liest.

Wichtig: Den Viewer nur kurz und lokal betreiben — er bindet auf `*:<port>`.

## Weltdaten auswerten

`src/blocks.js` zählt die Blocknamen im Umkreis des Spawns. Damit lassen sich Behauptungen über den Bau
belegen statt aus Screenshots zu raten:

```bash
MC_USER="dein@konto.tld" node src/blocks.js
# -> BLOCKNAMEN [["air",7077],["water",507],["dirt",462],["grass_block",360],...]
```

## Bekannte Grenzen

- **Protokollstand:** Wenn der Server neuer ist als `minecraft-data`, fehlen Weltdaten im Renderer oder
  die Session stirbt. Eine Protokollversion älter (über ViaVersion des Servers) liefert vollständige Chunks.
- **Stiller Drop:** Auf Proxy-/Limbo-Setups endet die Verbindung nach etwa einer Minute ohne Kick-Paket
  (`END socketClosed` / `ECONNRESET`). Das ist mit mineflayer nicht wegzubekommen; der Supervisor
  überbrückt mit wenigen Sekunden Lücke.
- **Limbo ohne Kommandos:** Landet der Bot in einer Limbo-/Lobby-Welt, existieren dort keine Kommandos
  (`help`, `list`, `server …` → `Unknown or incomplete command`) und das Inventar ist leer. Ein
  Serverwechsel muss dann über den Weg laufen, den der Server tatsächlich anbietet.
- **Sodium ist keine Option:** Sodium ist eine Fabric-Client-Mod und braucht GPU + Fenster. Der
  headless Renderer hat mit den Standard-Texturen vollständige Texturen, aber keine Shader.

## Keine Zugangsdaten im Repo

Das Repo enthält bewusst keine Konten, Tokens oder Passwörter. `auth/`, Logs, Screenshots und
`profile.json` sind per `.gitignore` ausgeschlossen.
