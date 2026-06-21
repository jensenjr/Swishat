# Swish Insamling

En gratis, kontofrihetsbaserad webbtjänst för att samla in pengar via Swish. Skapa en insamlingssida på sekunder, dela länken och låt bidragsgivare swisha direkt — utan mellanhänder eller avgifter.

> ⚠️ **Ej kopplat till Swish AB.** Betalningar sker direkt via användarnas egna Swish-appar. Denna tjänst hanterar inte pengar.

---

## Funktioner

- **Skapa insamlingar** med titel, beskrivning, målbelopp och rekommenderat belopp
- **Swish-djuplänk** som öppnar Swish-appen med referenskod förifylld och låst
- **Unik referenskod** per bidragsgivare (format: `XXXX-XXXX`) för enkel spårning
- **Adminpanel** med token-skyddad åtkomst — verifiera, ångra och ta bort bidrag
- **Valfri PIN-återhämtning** — hitta tillbaka till din adminpanel med Swish-nummer + PIN
- **Betalningsbevis via SMS** — om admin kräver det uppmanas betalaren ta en skärmdump och skicka via SMS med förfyllt meddelande och referenskod
- **Smart auto-förfall** med aktivitetsbaserad förlängning (se nedan)
- **Fullt på svenska** — hela gränssnittet och alla meddelanden

---

## Livscykel för insamlingar

| Händelse | Effekt |
|---|---|
| Insamling skapad | Aktiv i **14 dagar** |
| Ny betalning registreras när < 7 dagar kvar | Förlängs med **+7 dagar** |
| Admin klickar "Förläng" | Förlängs med **+14 dagar** |
| **30 dagar sedan skapande** | Hård gräns — kan ej överskridas |

---

## Teknikstack

| Del | Teknologi |
|---|---|
| Frontend | React 18, Tailwind CSS, `@tanstack/react-query` |
| Backend | Node.js + [Hono](https://hono.dev) |
| Databas | PostgreSQL (`postgres` / standard TCP) |
| Lösenordshashning | `argon2` |
| Build | Vite |
| Deploy | [Coolify](https://coolify.io) via Nixpacks |

---

## Driftsättning (Coolify)

### 1. Databas

Skapa en PostgreSQL-databas i Coolify och kör följande schema (Terminal → `psql -U postgres`):

```sql
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  target_amount NUMERIC,
  swish_number TEXT NOT NULL,
  suggested_amount NUMERIC,
  require_proof BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  admin_token TEXT NOT NULL,
  pin_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  hard_cap_at TIMESTAMPTZ NOT NULL,
  last_admin_activity_at TIMESTAMPTZ,
  last_contribution_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC,
  reference_code TEXT NOT NULL,
  status TEXT DEFAULT 'unverified',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

> ℹ️ Tabellerna `audit_log` (revisionslogg över adminåtgärder), `sms_codes`
> (engångskoder för SMS-återställning) och `sms_sends` (sändningslogg för
> abuse-gränser) skapas automatiskt vid serverstart (`CREATE TABLE IF NOT
> EXISTS`) — du behöver inte köra dem manuellt.

### 2. Applikation

- **Build Pack**: Nixpacks (auto-detekteras)
- **Miljövariabler**:

| Variabel | Värde |
|---|---|
| `DATABASE_URL` | Intern anslutningssträng från Coolify-databasen |
| `NODE_ENV` | `production` |
| `PORT` | `5000` (valfritt, standard) |
| `ELKS_API_USERNAME` | 46elks API-användarnamn (valfritt – för SMS) |
| `ELKS_API_PASSWORD` | 46elks API-lösenord (valfritt – för SMS) |
| `ELKS_FROM` | Avsändare: namn (max 11 tecken) eller 46elks-nummer (valfritt) |
| `STORAGE_DRIVER` | `local` (standard) eller `s3` för omslagsbilder |
| `UPLOAD_DIR` | Sökväg för bilder vid `local` (peka mot en Coolify-volym, t.ex. `/app/uploads`) |
| `S3_*` | Endast vid `s3` — se `.env.example` |

> 🔐 SMS-uppgifterna anges **endast** i Coolifys miljövariabler — aldrig i koden eller `.env.example`.
> Lämna dem tomma för att stänga av SMS-funktioner.

#### Omslagsbilder (lagring)

- **`local` (standard):** bilder skrivs till `UPLOAD_DIR` och serveras av appen på `/uploads/*`.
  I Coolify: lägg till en **Persistent Storage**-volym monterad på t.ex. `/app/uploads` och
  sätt `UPLOAD_DIR=/app/uploads`, annars försvinner bilderna vid varje deploy.
- **`s3`:** valfri S3-kompatibel lagring (AWS S3, Cloudflare R2, MinIO). Inga extra
  npm-beroenden — anrop signeras med SigV4. Sätt `S3_ENDPOINT`, `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` och `S3_PUBLIC_BASE_URL`.

### 3. Bygg & start

Nixpacks kör automatiskt:
```
npm ci → npm run build (Vite) → node server/index.js
```

---

## Lokal utveckling

```bash
git clone https://github.com/jensenjr/Swishat.git
cd Swishat
npm install
```

Skapa en `.env`-fil:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Starta Vite (frontend) och servern i varsitt terminalfönster:

```bash
# Terminal 1 — frontend med HMR på :5173
npm run dev

# Terminal 2 — API-server på :5000
node server/index.js
```

Vite proxar automatiskt `/api/*` till `localhost:5000`.

---

## Sidstruktur

| Sida | URL | Beskrivning |
|---|---|---|
| Startsida | `/` | Skapa ny insamling + återhämtning av admin-länk |
| Publik insamlingssida | `/c/:id` | Bidragsgivarens vy med Swish-djuplänk |
| Adminpanel | `/c/:id/admin?token=...` | Full kontroll — verifiera, ta bort, förläng |

---

## API-rutter

| Metod | Rutt | Beskrivning |
|---|---|---|
| `GET` | `/health` | Hälsokontroll |
| `POST` | `/api/collections` | Skapa ny insamling |
| `GET` | `/api/collections/:id` | Hämta insamling (+ bidrag om admin-token medföljer) |
| `PATCH` | `/api/collections/:id` | Uppdatera status eller förläng giltighetstid |
| `POST` | `/api/collections/recover` | Återhämta admin-länk via Swish-nummer + PIN |
| `POST` | `/api/collections/recover/sms/request` | Skicka engångskod via SMS (46elks) |
| `POST` | `/api/collections/recover/sms/verify` | Verifiera SMS-kod → admin-länk(ar) |
| `POST` | `/api/contributions` | Registrera nytt bidrag |
| `PATCH` | `/api/contributions/:id` | Uppdatera bidragsstatus eller belopp |
| `DELETE` | `/api/contributions/:id` | Ta bort bidrag |

---

## Säkerhet

- Admin-tokens genereras med en kryptografiskt säker slumpgenerator (`crypto.randomUUID`)
- Admin-token skickas i `Authorization`-headern, inte i URL:en, och jämförs i konstant tid
- PIN-koder hashas med `argon2` och sparas aldrig i klartext
- PIN-återhämtning skyddas av hastighetsbegränsning + utelåsning efter upprepade misslyckanden
- SMS-återhämtning: engångskoder hashas och lagras med utgångstid + försöksgräns; begränsad sändningstakt
- SMS-sändning har per-nummer-gränser (cooldown + max per timme/dygn, IP-oberoende) mot SMS-bombning; ingen SMS skickas till nummer utan koppling till en insamling
- Hastighetsbegränsning på skapande och bidrag
- Server-side validering av belopp och textlängder
- Säkerhetsheaders (CSP, `frame-ancestors 'none'`, `no-referrer`) och gräns på förfrågans storlek
- Parametriserade SQL-frågor genomgående (ingen SQL-injektion)
- Inga användarkonton — minimal datainsamling

---

## Licens

MIT — Fri att använda, modifiera och distribuera.
