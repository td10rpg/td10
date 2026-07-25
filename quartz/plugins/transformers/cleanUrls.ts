import { QuartzTransformerPlugin } from "../types"
import { FullSlug, resolveRelative } from "../../util/path"
import { visit } from "unist-util-visit"
import path from "path"

/**
 * CleanUrls — make short, flat URLs canonical without restructuring the vault.
 *
 * Phase 1 (markdown): for each page, override the canonical slug with its `slug`
 * frontmatter, or (fallback) its legacy `permalink` with `secret/` rewritten to
 * `supplemental/`. The original path-based slug is kept as an alias so old links
 * redirect (AliasRedirects emits the stub), and recorded in a map.
 *
 * Phase 2 (html): rewrite internal <a> hrefs that point at an old (aliased) slug
 * so they link DIRECTLY to the new canonical URL — no redirect hop on click.
 *
 * Relies on Quartz running the whole markdown phase before the html phase, so
 * the alias map is complete before any link is rewritten. The homepage (slug
 * "index") is always left at "/".
 */
export const CleanUrls: QuartzTransformerPlugin = () => {
  // old path-based slug (what wikilinks resolve to) -> new canonical slug
  const aliasToCanonical = new Map<string, FullSlug>()

  return {
    name: "CleanUrls",
    markdownPlugins(ctx) {
      const { allSlugs } = ctx
      return [
        () => {
          return (_tree, file) => {
            if (file.data.slug === "index") return
            const fm = file.data.frontmatter as Record<string, unknown> | undefined
            if (!fm) return

            let target: string | undefined
            if (typeof fm.slug === "string" && fm.slug.trim() !== "") {
              target = fm.slug
            } else if (typeof fm.permalink === "string" && fm.permalink.trim() !== "") {
              target = fm.permalink.replace(/^secret\//, "supplemental/")
            }
            if (!target) return

            const newSlug = target.trim().replace(/^\/+|\/+$/g, "") as FullSlug
            const oldSlug = file.data.slug as FullSlug
            if (!newSlug || newSlug === oldSlug) return

            // Keep the original path-based URL working as a redirect.
            const aliases = (file.data.aliases ?? []) as FullSlug[]
            if (!aliases.includes(oldSlug)) aliases.push(oldSlug)
            // The new canonical must not also be an alias (would self-redirect).
            file.data.aliases = aliases.filter((s) => s !== newSlug)

            file.data.slug = newSlug
            if (!allSlugs.includes(newSlug)) allSlugs.push(newSlug)
            if (!allSlugs.includes(oldSlug)) allSlugs.push(oldSlug)
            aliasToCanonical.set(oldSlug, newSlug)
          }
        },
      ]
    },
    htmlPlugins() {
      return [
        () => {
          return (tree, file) => {
            const curSlug = file.data.slug as FullSlug
            const curDir = path.posix.dirname(curSlug)
            visit(tree, "element", (node: any) => {
              if (node.tagName !== "a" || !node.properties) return
              const href = node.properties.href
              if (typeof href !== "string" || href === "") return
              // only internal, relative links (skip external / absolute / pure-anchor)
              if (/^(https?:|mailto:|tel:|\/\/|#|\/)/.test(href)) return

              const hashIdx = href.indexOf("#")
              const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href
              const anchor = hashIdx >= 0 ? href.slice(hashIdx) : ""
              if (pathPart === "") return

              // Reconstruct the absolute target slug this relative href points at.
              const targetSlug = path.posix
                .normalize(path.posix.join(curDir, pathPart))
                .replace(/\/+$/, "")

              const canonical = aliasToCanonical.get(targetSlug)
              if (!canonical) return
              node.properties.href = resolveRelative(curSlug, canonical) + anchor
            })
          }
        },
      ]
    },
  }
}
