# Ändringslogg

Alla märkbara ändringar i detta projekt dokumenteras här.
Formatet följer [Keep a Changelog](https://keepachangelog.com/sv/1.0.0/).

---

## [Opublicerad]

### Planerat
- Super-admin panel för support
- CSV-export av bidragslista
- E-postnotifikationer via Resend
- Automatisk databasrensning via cron-jobb

---

## [0.3.0] — 2026-05-07

### Tillagt
- **Swish-inspirerad design** — gradientfärger (lila → cyan → orange) genomgående i alla vyer, anpassad SVG-logotyp utan att kopiera Swish AB:s varumärke
- **Permanent dela-knapp** — visas i navigationsmenyn och som flytande knapp (mobilanpassad) på både publik sida och adminpanel
- **Native share-meny** — öppnar systemets deladialogruta med förfylld text på svenska inkl. insamlingens namn, mål och rekommenderat belopp
- **Valfri PIN-återhämtning** — admin kan välja en 4–6-siffrig PIN vid skapande för att senare återfå åtkomst via Swish-nummer + PIN
- **"Hitta min insamling"** — återhämtningssektion på startsidan för borttappade admin-länkar
- **Auto-förfall med smart förlängning** — insamlingar lever i 14 dagar; ny betalning inom 7 sista dagarna förlänger med +7 dagar automatiskt
- **Hård 30-dagarsgräns** — ingen insamling kan vara aktiv längre än 30 dagar totalt
- **Förläng-knapp i adminpanelen** — admin kan manuellt förlänga med 14 dagar (till max 30)
- **Färgkodade förfallsbanners** — gul (< 7 dagar), röd (< 2 dagar eller vid maxgräns)
- **"Ta bort"-knapp med bekräftelse** — admin kan ta bort felaktiga bidrag med bekräftelsedialog
- **"Ångra"-knapp** — admin kan ångra en verifiering om det var ett misstag
- **Verifiera alla** — knapp för att verifiera alla overifierade bidrag i ett steg
- **Betalningsbevis via SMS** — när admin kräver bevis öppnas SMS-appen med förfyllt meddelande inkl. referenskod; betalaren bifogar skärmdump manuellt
- **Skärmdump-varning före betalning** — tydlig varningsruta visas innan "Öppna Swish" om bevis krävs
- **"Jag har betalat klart"-knapp** — visas först efter att betalaren tryckt på Swish-länken (förhindrar för tidig klickning)
- **Aktivitetsindikatorer** — "Aktiv i X dagar till" visas på publik sida
- **Auto-refresh** — publik sida uppdateras var 30:e sekund, adminpanel var 15:e sekund

### Ändrat
- Hela gränssnittet och alla API-felmeddelanden översatta till **svenska**
- Adminpanelens flöde förbättrat med bättre tabelldesign och tydligare åtgärdsknappar
- Startsidan visar nu en **framgångsskärm** efter skapande med publik länk, admin-länk och dela-knapp — istället för direkt-redirect
- `layout.jsx` — lagt till `"use client"` och korrigerat `cacheTime` → `gcTime` för react-query v5-kompatibilitet

### Databasändringar
- Tillagda kolumner i `collections`:
  - `pin_hash TEXT` — argon2-hashat PIN för återhämtning
  - `last_admin_activity_at TIMESTAMPTZ` — senast admin var aktiv
  - `last_contribution_at TIMESTAMPTZ` — senaste inbetalning
  - `expires_at TIMESTAMPTZ` — dynamiskt förfallsdatum
  - `hard_cap_at TIMESTAMPTZ` — absolut maxdatum (skapandedatum + 30 dagar)

### Fixat
- `layout.jsx` saknade `"use client"` vilket kraschade hela appen (QueryClientProvider kan inte köras server-side)
- `uuid`-paketet ej tillgängligt — ersatt med inbyggd UUID-generator
- `window.location` anropades utan SSR-guard — wrappat i `useEffect` på alla sidor
- Befintliga databas-rader med `NULL` i nya kolumner backfylldes

---

## [0.2.0] — 2026-05-06

### Tillagt
- **Kräv bevis på betalning** — checkbox vid skapande; betalaren uppmanas ta skärmdump och skicka SMS
- **Dela insamling** — knapp på framgångsskärmen öppnar native share med förfylld text
- **Adminpanel** — token-skyddad vy med lista över alla bidragsgivare, verifieringsstatus och åtgärdsknappar
- **Verifiera/Ångra-knappar** — admin kan verifiera eller ångra verifiering av enskilda bidrag
- **Stäng/Öppna-insamling** — admin kan stänga insamlingen för nya bidrag eller öppna den igen
- **Statistikkort** i adminpanel — insamlat belopp, antal bidragsgivare, verifieringsgrad
- Fliknavigation i adminpanel: Alla / Overifierade / Verifierade
- Animerad cirkulär progress-ring på publik sida när målbelopp är satt

### Ändrat
- Gränssnittet delvis översatt till svenska
- Publik sida: "I have finished paying" → visar nu bekräftelseskärm

### Databasändringar
- Tillagd kolumn `require_proof BOOLEAN DEFAULT FALSE` i `collections`

---

## [0.1.0] — 2026-05-05

### Tillagt
- **Grundläggande insamlingsflöde** — skapa, visa och bidra till en insamling
- **Swish-djuplänk** — öppnar Swish-appen med mottagarnummer, belopp och referenskod förifylld
- **Referenskodgenerering** — unik 8-teckens kod (format `XXXX-XXXX`) per bidragsgivare
- **Token-skyddad adminlänk** — genereras vid skapande, ger åtkomst till adminpanelen
- Fält vid skapande: titel, beskrivning, Swish-nummer, målbelopp, rekommenderat belopp
- Progressbar (cirkulär) baserad på verifierade inbetalningar vs. målbelopp
- Statistik: insamlat belopp och antal bidragsgivare visas publikt
- REST API: `POST /api/collections`, `GET /api/collections/:id`, `POST /api/contributions`, `PATCH /api/contributions/:id`
- PostgreSQL-databas med tabellerna `collections` och `contributions`
