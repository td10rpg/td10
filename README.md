# Tiny d10

The free, tiny tabletop roleplaying game system — simple to learn, quick to play, and easy to adapt to any genre imaginable.

This repository holds both the **content** and the **website** for [Tiny d10](https://x.com/td10rpg). The site was previously published via Obsidian Publish and is now a static site built with [Quartz 4](https://quartz.jzhao.xyz/) and hosted on GitHub Pages.

**Live site:** https://m00minpappa.github.io/td10/

## Content

All notes live in [`content/`](content/), authored in [Obsidian](https://obsidian.md) Markdown (`[[wikilinks]]`, `![[embeds]]`, `permalink` frontmatter):

- **`index.md`, `About.md`, `Downloads.md`, `Resources.md`** — the main site pages.
- **`Core.md`** — the Tiny d10 core rule system.
- **`Supplemental Content/`** — extra material: supplemental classes, equipment, GM guidance, optional rules, and the Land of Glacia setting.
- **`Files/`** — PDFs, images, and templates (character sheets, zines, con kit, artwork).

`publish.css` is the stylesheet from the original Obsidian Publish site, kept for reference.

## Working with the site

```bash
npm install            # install dependencies (Node 22+, npm 10.4+)
npx quartz build --serve   # preview locally at http://localhost:8080
npx quartz build       # build the static site into public/
```

Editing content in Obsidian works too — just point Obsidian at the `content/` folder. Pushing to `main` triggers the GitHub Action (`.github/workflows/deploy.yml`) that builds and deploys to GitHub Pages.

Quartz configuration lives in `quartz.config.ts` (site title, base URL, theme) and `quartz.layout.ts` (page layout). Custom styling is in `quartz/styles/custom.scss`.

## License

Tiny d10 content is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [`LICENSE`](LICENSE). The Quartz site generator (`quartz/`) is MIT-licensed by its authors. When creating content for Tiny d10, all published work must:

1. **Attribution** — indicate that your work is built on the Tiny d10 Core system;
2. **ShareAlike** — be distributed under the same CC BY-SA 4.0 license.
