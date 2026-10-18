# Mediathek

Movies and series in one place, instead of switching between Radarr, Sonarr, qBittorrent and Jellyfin.

- **Search and add** with ⌘K / Ctrl+K: your library and everything Radarr and Sonarr can find, in one list. Pick the language (German, English, original) and the quality. Movies go to Radarr and series to Sonarr. On first use the app creates a matching profile there, for example "Mediathek 1080p Deutsch".
- **Library** as posters, with what's been watched (Jellyfin), what's playing, sizes and seasons.
- **qBittorrent** on the right: what's loading and what's seeding. Each torrent has its details and files, plus pause, load first, search another release, and remove.
- **Delete everywhere** in one step: Radarr or Sonarr with the files, the torrent and its copy in qBittorrent, and a Jellyfin refresh.
- **Clean-up**: free space, second copies in the downloads folder, watched titles, titles never started.
- **Automatic mode** (off by default, checked every 15 minutes), with four rules:
  - Remove torrents that have seeded enough, with their copy. The title stays.
  - Delete watched titles after a number of days.
  - When free space runs low, delete the watched titles that were watched longest ago.
  - Replace downloads that have been stuck for hours.

  Titles marked "Behalten", titles someone has started and titles being watched are never touched. A preview shows what the next run would do, and a log shows what was done.

No dependencies: `node server.js`, or with Docker `docker compose up -d --build`. Port 8098.

## Setup

Open the app and go to **Einstellungen**. Enter the address and API key for Radarr and Sonarr, the address and login for qBittorrent, and the address and API key for Jellyfin. Keys and passwords stay on the server in `data/config.json` (mode 600). Environment variables work too:

| Variable | |
|---|---|
| `RADARR_URL`, `RADARR_API_KEY` | movies |
| `SONARR_URL`, `SONARR_API_KEY` | series |
| `QBITTORRENT_URL`, `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD` | downloads |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_USER` | watched, playing |
| `DOWNLOADS_MAP` | `/downloads=/media/downloads`: qBittorrent's download path, and the same folder mounted read-only in here. With it the app can tell a second copy from a hardlink. |
| `PASSWORD` | optional login |
| `PORT`, `DATA_DIR` | 8098, `./data` |

## Try it

`npm run demo` starts the app on port 8131 with made-up services, so every flow can be tried without a real library.

`npm test` runs the tests.
