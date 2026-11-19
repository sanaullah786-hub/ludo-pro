# GitHub repository setup

## Repository details

| Field | Value |
|---|---|
| **Name** | `ludo-pro` |
| **Visibility** | Public (or Private - the workflow works for both) |
| **Description** | Ludo Pro - complete offline Android Ludo game (HTML5/CSS3/JS + Capacitor). Play vs Computer (Easy/Medium/Hard AI), 2-4 players offline, pass & play. Classic rules, virtual coins & daily rewards, no gambling. Debug APK built by GitHub Actions. By Sanaullah Khoso. |
| **Topics** | `ludo` `ludo-game` `board-game` `android` `android-game` `capacitor` `capacitor-android` `html5-game` `javascript` `offline-game` `game-ai` `pass-and-play` `mobile-game` `github-actions` `apk` |
| **Social preview** | upload `docs/social-preview.png` (Settings > General > Social preview) |
| **Initialize with README / .gitignore / license** | leave all **off** - the project already has them |

## Option 1 - GitHub website + git

1. github.com > **New repository** > name `ludo-pro`, paste the description, **do not** tick any "Add ..." boxes > *Create repository*.
2. In the project folder:

```bash
git remote add origin https://github.com/YOUR_USERNAME/ludo-pro.git
git push -u origin main
```

3. Add the topics (gear icon next to *About*) and the social preview image.

## Option 2 - GitHub CLI (one command)

```bash
gh auth login
gh repo create ludo-pro --public --source=. --remote=origin --push \
  --description "Ludo Pro - complete offline Android Ludo game (HTML5/CSS3/JS + Capacitor). Play vs Computer (Easy/Medium/Hard AI), 2-4 players offline, pass & play. Classic rules, virtual coins & daily rewards, no gambling. Debug APK built by GitHub Actions. By Sanaullah Khoso."
gh repo edit --add-topic ludo,ludo-game,board-game,android,android-game,capacitor,capacitor-android,html5-game,javascript,offline-game,game-ai,pass-and-play,mobile-game,github-actions,apk
```

## Get the APK

Pushing to `main` starts **Build Android APK** automatically (Actions tab). When it is green, open the run and download the
artifact **LudoPro-debug-apk**.

To publish the APK as a downloadable release, push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow then attaches `LudoPro-debug.apk` to a GitHub Release automatically.

## Recommended settings

- **Settings > Actions > General > Workflow permissions:** "Read and write permissions" (needed for the release step).
- **Settings > Branches:** protect `main` (optional) and require the *Build Android APK* check.
- After the first successful run, commit `package-lock.json` (created by `npm install`) and switch the workflow's install step to `npm ci` for faster, reproducible builds.
