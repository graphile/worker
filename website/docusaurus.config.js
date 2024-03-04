// @ts-check

/* eslint-disable @typescript-eslint/no-var-requires */

const lightCodeTheme = require("prism-react-renderer").themes.github;
const darkCodeTheme = require("prism-react-renderer").themes.dracula;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Graphile Worker",
  tagline: "A high performance job queue for PostgreSQL, written in Node.js",
  /*
  <link rel="apple-touch-icon" sizes="180x180" href="/img/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16x16.png">
  <link rel="manifest" href="/img/site.webmanifest">
  <link rel="mask-icon" href="/img/safari-pinned-tab.svg" color="#5bbad5">
  <link rel="shortcut icon" href="/img/favicon.ico">
  <meta name="msapplication-TileColor" content="#da532c">
  <meta name="msapplication-config" content="/img/browserconfig.xml">
  <meta name="theme-color" content="#ffffff">
  */
  favicon: "favicon.ico",

  url: "https://worker.graphile.org",
  baseUrl: "/",

  organizationName: "graphile",
  projectName: "worker",
  deploymentBranch: "gh-pages",
  trailingSlash: false,

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          editUrl: "https://github.com/graphile/worker/tree/main/website/",
          remarkPlugins: [
            [require("@docusaurus/remark-plugin-npm2yarn"), { sync: true }],
          ],
        },
        pages: {
          remarkPlugins: [
            [require("@docusaurus/remark-plugin-npm2yarn"), { sync: true }],
          ],
        },
        blog: false /*{
          showReadingTime: true,
          editUrl: "https://github.com/graphile/worker/tree/main/website/",
        }*/,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      }),
    ],
  ],

  plugins: [
    [
      "@docusaurus/plugin-content-blog",
      {
        /**
         * Required for any multi-instance plugin
         */
        id: "news",
        /**
         * URL route for the blog section of your site.
         * *DO NOT* include a trailing slash.
         */
        routeBasePath: "news",
        /**
         * Path to data on filesystem relative to site dir.
         */
        path: "./news",
      },
    ],
    function (context, options) {
      return {
        name: 'postcss-tweaker',
        configurePostCss(postcssOptions) {
          postcssOptions.plugins.push(require('postcss-nested'));
          return postcssOptions;
        }
      }
    }
  ],

  stylesheets: [
    {
      href: "https://fonts.googleapis.com/css2?family=Sarabun",
      type: "text/css",
    },
    {
      href: "https://fonts.googleapis.com/css2?family=Fredericka+the+Great&text=Use%20The%20Stack%20You%20Have.",
      type: "text/css",
    },
  ],

  headTags: [
    {
      tagName: "link",
      attributes: {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
    },
    {
      tagName: "link",
      attributes: { rel: "manifest", href: "/site.webmanifest" },
    },
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // image: "img/docusaurus-social-card.jpg",
      navbar: {
        title: "Graphile Worker",
        logo: {
          alt: "Graphile Worker",
          src: "img/logo.optimized.svg",
        },
        items: [
          {
            to: "docs",
            label: "Documentation",
            position: "left",
          },
          {
            to: "news",
            label: "News",
            position: "right",
          },
          {
            to: "releases",
            label: "Releases",
            position: "right",
          },
          {
            to: "sponsors",
            label: "Sponsor",
            position: "right",
          },
          {
            to: "pricing",
            label: "Go Pro",
            position: "right",
          },
          {
            href: "https://github.com/graphile/worker",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              {
                label: "Worker Introduction",
                href: "/docs",
              },
              {
                label: "Worker Quickstart",
                href: "/docs/cli#quickstart",
              },
              {
                html: '<a class="footer__link-item" href="https://postgraphile.org/">PostGraphile</a>',
              },
              {
                html: '<a class="footer__link-item" href="https://grafast.org">Gra<em>fast</em></a>',
              },
              {
                html: '<a class="footer__link-item" href="https://build.graphile.org/">Graphile Build</a>',
              },
              {
                html: '<a class="footer__link-item" href="https://star.graphile.org">Graphile*</a>',
              },
            ],
          },
          {
            title: "Community",
            items: [
              {
                label: "Discord",
                href: "https://discord.gg/graphile",
              },
              {
                label: "Mastodon",
                href: "https://fosstodon.org/@graphile",
              },
              {
                label: "Twitter",
                href: "https://twitter.com/GraphileHQ",
              },
            ],
          },
          {
            title: "More",
            items: [
              {
                label: "GitHub",
                href: "https://github.com/graphile/worker",
              },
              {
                label: "Sponsor",
                href: "https://graphile.org/sponsor",
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Graphile Ltd. Built with Docusaurus.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
      },
      algolia: {
        // The application ID provided by Algolia
        appId: "2VRSL786CS",

        // Public API key: it is safe to commit it
        apiKey: "b073f67c0ff7a9190d402ddd693c77fa",
        indexName: "worker-graphile",

        // Optional: see doc section below
        contextualSearch: true,

        // Optional: Algolia search parameters
        searchParameters: {},

        // Optional: path for search page that enabled by default (`false` to disable it)
        searchPagePath: "search",

        //... other Algolia params
      },
    }),
};

module.exports = config;
