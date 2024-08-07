/* eslint-disable @typescript-eslint/no-var-requires */

import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import CalloutSection from "@site/src/components/CalloutSection";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import SecondarySection from "@site/src/components/SecondarySection";
import TertiarySection from "@site/src/components/TertiarySection";
import HeroImage from "@site/static/img/homepage/ant-branch.svg";
import Layout from "@theme/Layout";
import clsx from "clsx";
import React from "react";

import HomepageTestimonials from "../components/HomepageTestimonials";
import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx(styles.heroBanner)}>
      <div className="container">
        <div className={clsx("row", styles.heroRow)}>
          <div className="col col--6">
            <div className={styles.github}>
              <Link to="https://github.com/graphile/worker">
                <img
                  className={styles.githubButton}
                  src="https://img.shields.io/github/stars/graphile/worker?label=Star&style=social"
                />
              </Link>
            </div>
            <h1 className={clsx("padding-vert--md", styles.hero)}>
              {siteConfig.tagline}
            </h1>
            <div className={styles.buttons}>
              <Link
                className={clsx(
                  "button button--primary button--lg margin-left--none margin-right--md",
                  styles.buttonHero,
                )}
                to="/docs"
              >
                Documentation
              </Link>
              <Link
                className={clsx(
                  "button button--outline button--lg margin-left--none",
                  styles.buttonHero,
                  styles.buttonHeroOutline,
                )}
                to="docs/cli#quickstart"
              >
                Quickstart
              </Link>
            </div>
          </div>
          <div className="col col--6">
            <HeroImage
              title="Coder sat at monitor"
              className={styles.heroImage}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={`${siteConfig.title}`} description={`${siteConfig.tagline}`}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <HomepageTestimonials />
        <CalloutSection
          title={`Crowd-funded open-source software`}
          body={`We're extremely grateful to our sponsors, for helping to fund ongoing development on Graphile Worker, Graphile Migrate, PostGraphile and the wider Graphile suite of tools.
          THANK YOU!`}
          link={`https://graphile.org/sponsor/`}
          buttonText={``}
        />
        <TertiarySection
          title={`Development Support`}
          tagline={`Priority text support straight from the maintainer`}
          body={`Give your company access to the knowledge and experience of the Graphile team through your chat server and GitHub/GitLab organization. Reference your code verbatim and arrange calls for any trickier topics.`}
          Svg={require("@site/static/img/homepage/support.svg").default}
          link={`https://www.graphile.org/support/`}
          buttonText={`Learn more`}
        />
        <SecondarySection
          title={`Graphile Starter`}
          tagline={`A quick-start project for full-stack application development in React, Node.js, GraphQL and PostgreSQL`}
          body={`Graphile Starter includes the foundations of a modern web application, with a full user registration system, session management, optimized job queue using Graphile Worker, pre-configured tooling, tests and much more.`}
          Svg={require("@site/static/img/homepage/starter.svg").default}
          link={`https://github.com/graphile/starter`}
          buttonText={`Learn more`}
        />
        <TertiarySection
          title={`Advanced planning and execution engine for GraphQL`}
          tagline={`The latest project from the Graphile team`}
          body={
            <>
              Gra<em>fast</em>&rsquo;s plan-based approach helps developers
              avoid common pitfalls and achieve better backend efficiency,
              leading to increased scalability and incredible performance your
              customers will love.
            </>
          }
          Svg={require("@site/static/img/homepage/grafast.svg").default}
          link={`https://grafast.org`}
          buttonText={`Grafast.org`}
        />
      </main>
    </Layout>
  );
}
