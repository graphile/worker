# Graphile Worker Website

This website is built using [Docusaurus 2](https://docusaurus.io/), a modern
static website generator.

### Installation

Git clone this repository.

**IMPORTANT**: Run all commands in the **root folder** of the repository,
**not** inside `/website`.

Install dependencies:

```bash
yarn
```

### Local Development

```bash
yarn website start
```

This command starts a local development server and opens up a browser window.
Most changes are reflected live without having to restart the server.

### Build

```bash
yarn website build
```

This command generates static content into the `build` directory and can be
served using any static contents hosting service.

### Deploy

```bash
yarn website deploy
```

Deploys the website to GitHub pages. Only committers can do this. At some point
we'll automate it with GitHub actions.
