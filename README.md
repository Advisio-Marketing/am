# AM

Interní nástroj pro snadný přístup a správu přidružených účtů na cenových srovnávačích (aktuálně primárně Heureka). Aplikace umožňuje pohodlně přepínat mezi různými klientskými účty v přehledném rozhraní se záložkami a automaticky spravuje přihlašovací cookies.

## Klíčové Vlastnosti

- **Dynamické načítání účtů:** Seznam spravovaných účtů se načítá z interního API (`app.advisio.cz`).
- **Přehledný Sidebar:** Zobrazení všech dostupných účtů v postranním panelu.
- **Vyhledávání v Sidebaru:** Možnost filtrovat seznam účtů podle názvu klienta.
- **Rozhraní se Záložkami (Taby):** Otevřené účty se zobrazují jako záložky (podobně jako v prohlížeči) pro snadné přepínání.
- **Izolované Sessions:** Každá otevřená záložka (účet) běží ve vlastní, oddělené a persistentní session, což zajišťuje správnou izolaci cookies a přihlášení.
- **Automatická Správa Cookies:**
  - Načítání specifických přihlašovacích cookies (`rr_cookies`) z API pro každý účet.
  - Dynamické určení cílové domény (`.cz` / `.sk`) na základě `HEU_COVER_country` cookie.
  - Nastavení potřebných Consent cookies pro zajištění funkčnosti webu.
- **Měnitelná Šířka Sidebaru:** Uživatel si může upravit šířku postranního panelu podle potřeby.
- **Automatické Aktualizace:** Aplikace obsahuje mechanismus pro kontrolu a instalaci aktualizací z interního firemního serveru (využívá `electron-updater`).

## Použité Technologie

- **Electron:** Rámec pro tvorbu desktopových aplikací pomocí webových technologií.
  - `BaseWindow` & `WebContentsView`: Pro flexibilní správu hlavního okna a jednotlivých webových pohledů (záložek).
  - `Session`: Pro správu izolovaných relací a cookies.
  - `net`: Pro síťové požadavky na interní API.
  - `ipcMain` / `ipcRenderer`: Pro komunikaci mezi hlavním a renderer procesem.
- **React:** Knihovna pro tvorbu uživatelského rozhraní (sidebar, tab bar, ovládací prvky).
- **Vite:** Nástroj pro rychlý vývoj a build React aplikace.
- **Node.js:** Běhové prostředí pro hlavní proces Electronu.
- **electron-updater:** Knihovna pro zjednodušení implementace automatických aktualizací.
- **electron-log:** Pro pokročilé logování v hlavním i renderer procesu.

## Instalace a Použití (pro uživatele)

Tato aplikace je určena pouze pro interní firemní použití.

1.  **Získání Instalátoru:** Kontaktujte prosím vaše IT oddělení nebo správce této aplikace pro získání nejnovějšího instalačního balíčku (`.exe` pro Windows, `.dmg` pro macOS).
2.  **Instalace:** Spusťte stažený instalační soubor a postupujte podle pokynů.
3.  **Aktualizace:** Aplikace by měla automaticky kontrolovat nové verze a nabídnout vám jejich instalaci po stažení. Stačí aplikaci restartovat, když vás k tomu vyzve.

## Nastavení pro Vývojáře

Pro spuštění aplikace ve vývojovém režimu nebo pro další vývoj:

1.  **Klonování Repozitáře:**
    ```bash
    git clone <URL_VAŠEHO_REPOZITÁŘE>
    cd am
    ```
2.  **Instalace Závislostí:**
    ```bash
    npm install
    ```
3.  **Spuštění Vývojového Prostředí:**
    Tento příkaz spustí Vite dev server pro React UI a následně Electron aplikaci, která se na něj připojí. Změny v React kódu by se měly projevit téměř okamžitě (HMR).
    ```bash
    npm run dev
    ```
    _(Alternativně můžete spustit `npm run dev:vite` v jednom terminálu a `npm run dev:electron` v druhém, až bude Vite připraven.)_

## Build Produkční Verze

Pro vytvoření distribučních balíčků (instalátorů) pro různé platformy:

1.  **Ujistěte se, že konfigurace v `package.json` (sekce `build`) je správná** (zejména `appId`, `productName`, `files`, cesty k ikonám a `publish.url` pro váš interní update server).
2.  **Spusťte build:**
    ```bash
    npm run build
    ```
    _(Tento příkaz nejprve sestaví React aplikaci pomocí Vite a poté spustí `electron-builder`.)_
3.  **Výstup:** Výsledné instalační balíčky najdete v adresáři definovaném v `directories.output` (výchozí je `dist/electron/`). Tyto soubory pak můžete distribuovat interně a také nahrát na váš update server (viz komentář v `main/main.js` o potřebných souborech).

## Licence

Proprietární software – Pouze pro interní použití v rámci [Název Vaší Firmy].

---

_Tento README soubor popisuje stav aplikace k [Doplňte Datum]._
