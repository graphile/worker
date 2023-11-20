---
title: "Worker Pro!"
sidebar_position: 46
---

Worker Pro (`@graphile-pro/worker`) is a proprietary (not open source) preset
for Graphile Worker that adds advanced and quality-of-life features. Graphile
Worker existed for 5 years without these features, so they are definitely not
essential, but they are things your team is likely to appreciate:

- [Live migration](./migration.md) &mdash; remove the need to scale to zero to
  safely upgrade Worker versions
- [Crashed worker recovery](./recovery.md) &mdash; track running workers and
  unlock jobs automatically when a worker seems to have unexpectedly stopped
- _More features planned_

_~~Worker Pro is priced at USD $100/mo and helps to fund the ongoing maintenance
of Graphile Worker and other Graphile projects. It is also available
**[free to sponsors](https://github.com/sponsors/benjie)** on the $100/mo tier
or above.~~_

:::tip Launch offer

Worker Pro is in early access with a limited feature set; during this period get
access by [sponsoring](https://github.com/sponsors/benjie) at **just $25+/mo**
and, as a thank you for being an early adopter, keep this preferential rate for
at least 18 months after the launch offer ends.

:::

## Getting access

Worker Pro is currently in sponsors-only early access; any
[sponsor](https://github.com/sponsors/benjie) on ~~$100/mo~~ $25+/mo may request
access from @jemgillam or @benjie via the Discord, or email `team` at the domain
`graphile.com`. Access to Worker Pro grants access to the GitHub Packages module
and
[the source code repository on GitHub](https://github.com/graphile-pro/worker),
including the ability to
[file issues](https://github.com/graphile-pro/worker/issues/new) and open
discussions about Worker Pro.

### Source available

Worker Pro is not open source, but it is &ldquo;source available&rdquo;; the
source code is licensed in a way that forbids publishing and redistribution but
is otherwise very flexible, allowing you to make your own modifications for
internal usage should you need to do so:

```md
Copyright © 2023 Benjie Gillam

Use and modification of this software and associated documentation files (the
“Software”) is permitted, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software. The Software is not to be
distributed, published, sold, or sub-licensed.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

<!--

Log in to https://store.graphile.com using the account that you sponsor us
through, if you're a sponsor, or whichever method you prefer otherwise.

-->

## Installation

Worker Pro can be installed from GitHub Packages using
[an authenticated `authToken` or `npm login --scope=@graphile-pro`](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-with-a-personal-access-token).

Create a `.npmrc` in your project directory containing:

```text title=".npmrc"
@graphile-pro:registry=https://npm.pkg.github.com
```

This will tell `npm` (and `yarn`, etc) that any `@graphile-pro/*` package should
instead be installed from the GitHub Packages package registry rather than from
the regular npm package registry.

:::tip

You need to authenticate to GitHub packages, one way to do this is to create a
`.npmrc` file in your home directory (this is **different** to the `.npmrc` in
your project folder mentioned above), and enter into it:

```text title="~/.npmrc"
//npm.pkg.github.com/:_authToken=TOKEN
```

Replace `TOKEN` with a GitHub personal access token with the `read:packages`
scope (it might be nested under `write:packages`); you can generate a personal
access token at
[https://github.com/settings/tokens](https://github.com/settings/tokens).

:::

Then (assuming you have your
[GitHub Packages authentication configured](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-with-a-personal-access-token))
you can install as you would any other module:

```bash npm2yarn
npm install --save @graphile-pro/worker
```

:::tip

For more help installing from GitHub packages, see the GitHub Packages
documentation, in particular:

- [Authenticating with a personal access token](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-with-a-personal-access-token),
  and
- [Installing a package](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#installing-a-package).

If you still need help, ask in #help-and-support on the
[Graphile Discord](https://discord.gg/graphile).

:::

## Usage

Load `@graphile-pro/worker` as a preset into your
[graphile.config.ts or similar file](../config.md) via the `extends` key:

```ts title="graphile.config.ts"
import type {} from "graphile-config";
import type {} from "graphile-worker";
import { WorkerProPreset } from "@graphile-pro/worker";

const preset: GraphileConfig.Preset = {
  extends: [WorkerProPreset],
  worker: {
    /* Your worker config options here */
  },
};
```

## FAQ

### If I pay for Worker Pro, am I a sponsor?

**If you [sponsor Graphile](https://github.com/sponsors/benjie/) at $100+/mo via
GitHub Sponsors then Worker Pro is included as one of the many perks to
sponsorship.**

Paying $100/mo for Worker Pro via Graphile Store _(not available at time of
writing)_ gives you access to Worker Pro but that is all, you are not a sponsor
and you are not entitled to other
[sponsor perks](https://github.com/sponsors/benjie/). We strongly encourage you
to sponsor Graphile instead, there&apos;s only upsides!

Why? Some companies claim they &ldquo;cannot&rdquo; use sponsorship platforms;
if your company is one of these then either you need to make do without the
additional sponsor perks, or you need to help your organization to see the value
of supporting the software that their business relies upon. Once you&apos;ve
successfully gained approval for sponsorship, you may discover other valuable
open source projects within your stack that you could benefit from supporting.
Ready to enhance the entire open source ecosystem together?

### Is Worker Pro needed for production usage?

No, absolutely not! Graphile Worker existed without these features for 5 years
so they are not &ldquo;essential&rdquo;; they're &ldquo;nice to have&rdquo;
features, especially for larger teams or systems with more complex deployments.

### Can I implement these features myself instead?

Sure! Worker Pro is just a preset for the open source Graphile Worker, so you
have all the same interfaces that we do! Hopefully it will work out
significantly cheaper and easier to use Worker Pro than to build the solution
yourself, and Worker Pro has been designed by the maintainer of Graphile Worker
so it thinks carefully about all the edge cases, but if your needs are limited
or your budget is constrained then please go ahead and use the plugin and events
system to implement a similar solution. (Please note that it&apos;s extremely
unlikely we&apos;ll accept your solution as a pull request.)

:::tip Not for profit?

If your budget is constrained because you&apos;re a charity or non-profit
organization (including community projects such as Makerspaces) please get in
touch and we may be able to offer you a discount.

:::

:::info Starting a competitor?

Want to open source your own alternative, or maybe even build a business around
it? You're entirely welcome to do so &mdash; that is the open source way! But,
please consider sponsoring us anyway, to support us to keep improving the
underlying open source project for you and your users.

We retain copyright in Worker Pro, so if you are going to implement and
distribute your own solution, ensure that you do it without using or being
&ldquo;inspired by&rdquo; the source code to Graphile Pro. Figure out your own
independent solution, please.

:::
