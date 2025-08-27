# GitHub Actions Build Instructions

## Automatické buildy pomocí GitHub Actions

Tento projekt obsahuje GitHub Actions workflow, který automaticky postaví aplikaci pro všechny platformy:

- **macOS** (Intel x64 + Apple Silicon ARM64)
- **Windows** (x64 + x32)
- **Linux** (AppImage + DEB)

### Jak spustit build:

#### 1. Automatické spuštění

Build se spustí automaticky při:

- Push do `master` nebo `main` větve
- Vytvoření Pull Requestu

#### 2. Manuální spuštění

1. Jdi na GitHub do sekce **Actions**
2. Vyber workflow **"Build AM"**
3. Klikni na **"Run workflow"**
4. Vyber větev a klikni **"Run workflow"**

### Stažení výsledků:

Po dokončení buildu najdeš soubory v sekci **Artifacts**:

- **am-macos** - DMG soubory pro Mac
- **am-windows** - EXE/ZIP soubory pro Windows
- **am-linux** - AppImage/DEB soubory pro Linux

### Poznámky:

- **Credentials**: Workflow používá dummy credentials pro build - po stažení musíš nahradit `credentials.json` skutečnými hodnotami
- **Podepisování**: Aplikace nejsou podepsané (vyžaduje certificates)
- **Doba buildu**: Kompletní build trvá obvykle 10-20 minut

### Troubleshooting:

Pokud build selže:

1. Zkontroluj logs v GitHub Actions
2. Ujisti se, že jsou všechny dependencies v `package.json`
3. Ověř, že build funguje lokálně: `npm run build:mac`

## Lokální build příkazy:

```bash
# Mac (na macOS)
npm run build:mac

# Windows (na Windows nebo přes GitHub Actions)
npm run build:win

# Linux (na Linux nebo přes GitHub Actions)
npm run build:linux

# Všechny platformy najednou
npm run build:all
```
