# NetFlow Globe v2

Live packet flow visualizer — fetches from ntop, geocodes IPs, resolves hostnames, detects device OS, and renders animated arcs on a world map.

# Architecture
Install ntop-ng on pfsense firewall
Install docker on a vlan where ntop accessible 
Ntop fetches data from pfsense
Netflow fetches data from Ntop-ng lactive flow endpoint

Tested on ntopng Community v.6.2.250909 rev.0 (FreeBSD 15.0) | pfsense 2.8.1

# Demo
https://github.com/user-attachments/assets/9f373a97-af63-43fd-9c9a-c19053923f6b


**Zero npm dependencies.** Pure Node.js built-ins only.

---

## Quick Start

### Bare Node.js
```bash
# Set your credentials in config.js or via env vars, then:
node server.js
```
Open → **http://localhost:3000**

### Docker Compose (recommended)
```bash
# 1. Edit credentials in docker-compose.yml
# 2. Build and start
docker compose up --build -d

# Follow logs
docker compose logs -f

# Stop
docker compose down
```

### Docker run (manual)
```bash
docker build -t netflow-globe .

docker run -d \
  --name netflow-globe \
  --network host \
  -e NTOP_HOST=ntop.nrhomelab.com \
  -e NTOP_USER=admin \
  -e NTOP_PASS=password123 \
  -v netflow-data:/data \
  -p 3000:3000 \
  netflow-globe
```

---

## Project Structure

```
netflow-globe/
├── server.js               Entry point — wires modules, runs poll loop
├── config.js               Shared config singleton + dynamic QPARAMS
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── public/
│   └── index.html          Globe UI (served statically)
└── modules/
    ├── auth.js             POST /authorize.html → session cookie
    ├── fetcher.js          HTTPS GET ntop → raw snapshot + parsed JSON
    ├── extractor.js        Parse flows, extract IPs + ntop hostnames
    ├── geo.js              ip-api.com batch geo lookup, cache: geo_cache.json
    ├── dns.js              Async reverse DNS, cache: dns_cache.json
    ├── websocket.js        WS frame encoder, broadcast(), upgrade handler
    └── httpServer.js       HTTP server + /api/* routes
```

### Data flow per poll cycle

```
ntop HTTPS GET
     │
     ▼
fetcher.js       → saves data/raw_<ts>.json
     │
     ▼
extractor.js     → saves data/flows_latest.json  (IPs + metadata)
     │
     ▼
geo.js           → saves data/geo_cache.json      (lat/lon per IP)
     │
     ▼
dns.js           → saves data/dns_cache.json      (hostname per IP, async)
     │
     ▼
websocket.js     → broadcasts enriched flows to all browser clients
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NTOP_HOST` | `ntop.nrhomelab.com` | ntop hostname (no https://) |
| `NTOP_USER` | `admin` | ntop username |
| `NTOP_PASS` | `password123` | ntop password |
| `PORT` | `3000` | UI + API + WebSocket port |
| `POLL_MS` | `3000` | Fetch interval in milliseconds |
| `HOME_LAT` | `10.8505` | Latitude for private IPs |
| `HOME_LON` | `76.2711` | Longitude for private IPs |
| `DEFAULT_IFID` | `0` | Default interface ID |
| `DEFAULT_LENGTH` | `50` | Default max flows per poll |
| `DEFAULT_PROTO` | `tcp` | Default protocol (`tcp` or `udp`) |
| `DATA_DIR` | `/data` | Directory for caches + snapshots |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Globe UI |
| `GET` | `/api/flows` | Latest enriched flow data (JSON) |
| `GET` | `/api/snapshots` | List of raw snapshot filenames |
| `GET` | `/api/status` | Server uptime, current params, cookie snippet |
| `POST` | `/api/renew-session` | `{"user":"…","pass":"…"}` → renews ntop cookie |
| `POST` | `/api/set-params` | `{"ifid":"2","length":"100","proto":"udp"}` |
| `WS` | `/ws` | Real-time flow updates |

---

## Persisted Data (`/data` volume)

| File | Contents |
|---|---|
| `raw_<timestamp>.json` | Raw ntop API response (rotates, keeps last 20) |
| `flows_latest.json` | Latest enriched flows with geo + hostnames |
| `geo_cache.json` | IP → lat/lon/country/city (survives restarts) |
| `dns_cache.json` | IP → hostname from reverse DNS (survives restarts) |

---

## OS Detection (device colouring)

Packets are coloured by the detected OS of the **source device** based on hostname pattern matching:

| OS | Colour | Hostname keywords |
|---|---|---|
| Windows | Blue `#1d7ff5` | win, win-11, win-10, DESKTOP, w10, w11 |
| Android | Green `#22c55e` | oppo, nokia, redmi, oneplus, vivo, moto, motorola, huawei, xiaomi, google, pixel, nothing, android |
| Linux | Red `#ef4444` | kali, debian, ubuntu, localhost, docker, proxmox, ludus, unraid, raspberrypi, linux |
| iOS | Dark grey `#94a3b8` | iphone, ipad |
| macOS | Light grey `#cbd5e1` | mac, macbook, macpro, imac, macmini |
| Other | Yellow `#facc15` | unmatched local device |

Hostname sources (in priority order): ntop `client.name` → reverse DNS → raw IP.

---

## UI Controls

| Control | Action |
|---|---|
| Scroll wheel | Zoom in/out |
| Click + drag | Pan |
| Double left-click | Zoom out |
| Double right-click | Zoom in |
| ⧩ FILTER | Open filter bar (IP, port, hostname filters + interface/length/proto) |
| 🔑 SESSION | Open session renewal modal |
| ⏸ PAUSE | Freeze packet animation |
| + / − / ⌂ | Zoom buttons |

Country names appear at zoom ≥ 1.8×. Hostname labels with OS tags appear at zoom ≥ 2.5×.

---

## Updating the Session Cookie

The server auto-logins on startup and auto-retries on session expiry using `NTOP_USER`/`NTOP_PASS`.

To renew manually: click **🔑 SESSION** in the UI → enter credentials → **LOGIN & RENEW**.

---

## Network Mode Note

`docker-compose.yml` uses `network_mode: host` by default so the container can reach ntop on your LAN directly. If ntop is on the public internet, switch to bridge networking:

```yaml
# In docker-compose.yml, replace:
network_mode: host
# With:
ports:
  - "3000:3000"
```
