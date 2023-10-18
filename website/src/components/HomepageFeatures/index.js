import clsx from "clsx";
import React from "react";

import styles from "./styles.module.css";

const FeatureList = [
  {
    title: "Reliable",
    Svg: require("@site/static/img/undraw_docusaurus_mountain.svg").default,
    description: (
      <>
        Automatic retries with automatic exponential backoff; built on Postgres'
        reliable transactions. Never lose a job.
      </>
    ),
  },
  {
    title: "High Performance",
    Svg: require("@site/static/img/undraw_docusaurus_react.svg").default,
    description: (
      <>
        Up to 10,000 jobs per second; keep your infrastructure simple (just
        Postgres and Node) and focus on your project!
      </>
    ),
  },
  {
    title: "Cron Jobs",
    Svg: require("@site/static/img/undraw_docusaurus_tree.svg").default,
    description: (
      <>
        Set up repeating tasks with minute-by-minute granularity; optional
        backfill to cover times when your servers weren't running.
      </>
    ),
  },
  {
    title: "Low latency",
    Svg: require("@site/static/img/undraw_docusaurus_react.svg").default,
    description: (
      <>
        Jobs start in milliseconds thanks to Postgres' LISTEN/NOTIFY; delight
        customers with near real-time background processing.
      </>
    ),
  },
  {
    title: "Job Control",
    Svg: require("@site/static/img/undraw_docusaurus_tree.svg").default,
    description: (
      <>
        Schedule jobs to run in the future. Debounce jobs to avoid redundant
        work. Cancel or update scheduled jobs.
      </>
    ),
  },
  {
    title: "Easy Migration",
    Svg: require("@site/static/img/undraw_docusaurus_mountain.svg").default,
    description: (
      <>
        Want to migrate to a dedicated job queue later? No problem! Examples of
        exporting jobs to other queues are included!
      </>
    ),
  },
];

function Feature({ Svg, title, description }) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
