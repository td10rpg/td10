import { QuartzTransformerPlugin } from "../types"
import { FullSlug, resolveRelative } from "../../util/path"
import { visit } from "unist-util-visit"
import path from "path"

/**
 * Permalink — make a page's `permalink` frontmatter its canonical URL.
 *
 * The URL "system" doesn't analyze hierarchy: each page's canonical slug is
 * simply its `permalink` value. Because permalinks mirror the vault folders,
 * Quartz's native nav + breadcrumbs stay hierarchical and consistent — no fork.
 *
 * Phase 1 (markdown): set the canonical slug from `permalink`, keep the original
 * path-based slug as an alias (AliasRedirects emits the redirect), and record
 * the mapping.
 * Phase 2 (html): rewrite internal <a> hrefs that resolve to an old (aliased)
 * slug so they point DIRECTLY at the permalink URL — no redirect hop.
 *
 * The homepage (slug "index") is always left at "/".
 */
export const Permalink: QuartzTransformerPlugin = () => {
  // old path-based slug (what wikilinks resolve to) -> permalink slug
  const aliasToCanonical = new Map<string, FullSlug>()

  return {
    name: "Permalink",
    markdownPlugins(ctx) {
      const { allSlugs } = ctx
      return [
        () => {
          return (_tree, file) => {
            if (file.data.slug === "index") return
            const fm = file.data.frontmatter as Record<string, unknown> | undefined
            const permalink = fm?.permalink
            if (typeof permalink !== "string" || permalink.trim() === "") return

            const newSlug = permalink.trim().replace(/^\/+|\/+$/g, "") as FullSlug
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
