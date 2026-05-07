# Swish Insamling

En gratis, kontofrihetsbaserad webbtjänst för att samla in pengar via Swish. Skapa en insamlingssida på sekunder, dela länken och låt bidragsgivare swisha direkt — utan mellanhänder eller avgifter.

> ⚠️ **Ej kopplat till Swish AB.** Betalningar sker direkt via användarnas egna Swish-appar. Denna tjänst hanterar inte pengar.


## Funktioner

- **Skapa insamlingar** med titel, beskrivning, målbelopp och rekommenderat belopp
- **Swish-djuplänk** som öppnar Swish-appen med referenskod förifylld och låst
- **Unik referenskod** per bidragsgivare (format: `XXXX-XXXX`) för enkel spårning
- **Adminpanel** med token-skyddad åtkomst — verifiera, ångra och ta bort bidrag
- **Valfri PIN-återhämtning** — hitta tillbaka till din adminpanel med Swish-nummer + PIN
- **Betalningsbevis via SMS** — om admin kräver det uppmanas betalaren ta en skärmdump och skicka via SMS med förfyllt meddelande och referenskod
- **Dela-funktion** — native share-meny eller kopiering med förfylld text på svenska inkl. mål och rekommenderat belopp
- **Smart auto-förfall** med aktivitetsbaserad förlängning (se nedan)
- **Fullt på svenska** — hela gränssnittet och alla meddelanden

---

## Livscykel för insamlingar

| Händelse | Effekt |
|---|---|
| Insamling skapad | Aktiv i **14 dagar** |
| Ny betalning registreras när < 7 dagar kvar | Förlängs med **+7 dagar** |
| Admin klickar "Förläng" | Förlängs med **+14 dagar** |
| **30 dagar sedan skapande** | Raderas automatiskt — hård gräns, kan ej överskridas |

> Insamlingen kan aldrig vara aktiv mer än **30 dagar totalt** oavsett aktivitet.

---

## Teknikstack

| Del | Teknologi |
|---|---|
| Frontend | React 18, Tailwind CSS |
| Backend | Node.js serverless API-routes |
| Databas | PostgreSQL via Neon (`@neondatabase/serverless`) |
| Datahämtning | `@tanstack/react-query` |
| Lösenordshashning | `argon2` |
| Ikoner | `lucide-react` |

---

## Installation

### Krav

- Node.js 18+
- En PostgreSQL-databas (t.ex. [Neon](https://neon.tech))

### Klona och installera

```bash
git clone https://github.com/ditt-repo/swish-insamling.git
cd swish-insamling
npm install
```

### Miljövariabler

Skapa en `.env.local`-fil i projektroten:

```env
DATABASE_URL=postgresql://user:password@host/dbname
```

### Databasschema

Kör följande SQL mot din PostgreSQL-databas:

```sql
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  target_amount NUMERIC,
  swish_number TEXT NOT NULL,
  suggested_amount NUMERIC,
  admin_token TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  require_proof BOOLEAN DEFAULT FALSE,
  pin_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_admin_activity_at TIMESTAMPTZ DEFAULT NOW(),
  last_contribution_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  hard_cap_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  reference_code TEXT NOT NULL,
  amount NUMERIC,
  status TEXT DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Starta lokalt

```bash
npm run dev
```

Öppna [http://localhost:3000](http://localhost:3000).

---

## Sidstruktur

| Sida | URL | Beskrivning |
|---|---|---|
| Startsida | `/` | Skapa ny insamling + återhämtning |
| Publik insamlingssida | `/c/[id]` | Bidragsgivares vy |
| Adminpanel | `/c/[id]/admin?token=...` | Admin-vy med full kontroll |

---

## API-rutter

| Metod | Rutt | Beskrivning |
|---|---|---|
| `POST` | `/api/collections` | Skapa ny insamling |
| `GET` | `/api/collections/:id` | Hämta insamling (+ bidrag om admin-token medföljer) |
| `PATCH` | `/api/collections/:id` | Uppdatera status eller förläng giltighetstid |
| `POST` | `/api/collections/recover` | Återhämta admin-länk via Swish-nummer + PIN |
| `POST` | `/api/contributions` | Registrera nytt bidrag |
| `PATCH` | `/api/contributions/:id` | Uppdatera bidragsstatus |
| `DELETE` | `/api/contributions/:id` | Ta bort bidrag |

---

## Säkerhet

- Admin-tokens är UUID:n genererade server-side och exponeras aldrig i källkod
- PIN-koder hashas med `argon2` och sparas aldrig i klartext
- Varje admin-API-anrop validerar token innan åtgärd utförs
- Inga användarkonton — minimal datainsamling per GDPR-principer

---

## Planerad utveckling (v2)

- [ ] Super-admin panel för support och användarhjälp
- [ ] CSV-export av bidragslista från adminpanelen
- [ ] E-postnotifikationer (via Resend)
- [ ] Insamlingsmallar (t.ex. "Födelsedagspresent", "Kickback", "Klasskassa")
- [ ] Automatisk databasrensning via schemalagda cron-jobb
- [ ] Flerspråkigt stöd (engelska, norska, danska)

---

## Licens

MIT — Fri att använda, modifiera och distribuera.
