import { defineConfig } from "vitepress";

function normalizeBase(base: string): string {
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  return base;
}

const repoName = "civic-simulation";
const repoOwner = process.env.CANONICAL_OWNER ?? "cap-jmk-real";
const defaultBase =
  process.env.NODE_ENV === "development" ? "/" : `/${repoName}/`;
const base = normalizeBase(process.env.BASE_PATH ?? defaultBase);

export default defineConfig({
  lang: "en-US",
  title: "Civic simulation",
  description: "Discrete-time ABM + web lab UI.",

  base,

  themeConfig: {
    siteTitle: "ABM IP modelling",

    nav: [
      { text: "Guide", link: "/guide/quickstart" },
      { text: "Concepts", link: "/concepts/overview" },
      { text: "Math", link: "/GRID_BATCH_MATH" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Quickstart", link: "/guide/quickstart" },
            { text: "Lab queue & worker", link: "/guide/lab-queue" },
            { text: "Windows native setup", link: "/guide/windows-native" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/concepts/": [
        {
          text: "Concepts",
          items: [
            { text: "Overview", link: "/concepts/overview" },
            { text: "Metrics", link: "/concepts/metrics" },
          ],
        },
      ],
      "/": [
        {
          text: "Docs",
          items: [
            { text: "Quickstart", link: "/guide/quickstart" },
            { text: "Lab queue & worker", link: "/guide/lab-queue" },
            { text: "Windows native setup", link: "/guide/windows-native" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
            { text: "Concepts", link: "/concepts/overview" },
            { text: "Parameter grid math", link: "/GRID_BATCH_MATH" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: `https://github.com/${repoOwner}/${repoName}` }],
  },
});

