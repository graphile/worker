/* eslint-disable @typescript-eslint/no-var-requires */

import styles from "@site/src/components/HomepageTestimonials/styles.module.css";
import TestimonialImage from "@site/static/img/homepage/ant-leaf.svg";
import clsx from "clsx";
import React from "react";

const TestimonialList = [
  {
    author: "Etan",
    image: require("@site/static/img/testimonials/discord.png").default,
    quote: (
      <>
        Hey 👋 currently using Worker in production. It&apos;s been a fantastic
        library that has allowed us to really simplify our tech stack to
        bootstrap projects.
      </>
    ),
  },
  {
    author: "theIntuitionist",
    image: require("@site/static/img/testimonials/reddit.png").default,
    quote: (
      <>
        I have Worker running along with postgrest and it is the perfect
        companion. It helps keep the dev ops side super simple &mdash; Graphile
        Worker runs right from within the node project if you want it to &mdash;
        reducing costs and devops complexity.
      </>
    ),
  },
  {
    author: "Max",
    image: require("@site/static/img/testimonials/discord.png").default,
    quote: (
      <>
        Worker let us scale out millions of tasks. Graphile tooling has become
        the standard of quality and thoughtfulness by which I judge all other
        libraries when evaluating them for use.
      </>
    ),
  },
  {
    author: "bennyp101",
    image: require("@site/static/img/testimonials/news.png").default,
    quote: (
      <>
        I use Postgres as a queue using Graphile Worker and it works perfectly.
        No need for another moving part when the data I need is in the db. Also
        avoids having to do outbox stuff.
      </>
    ),
  },
];

function Testimonial({ author, quote, image }) {
  return (
    <div className={clsx(styles.testimonial)}>
      <div className={styles.creditAvatar}>
        <img src={image} />
      </div>
      <div className="container">
        <div className={styles.creditAuthorDetails}>
          <strong>{author}</strong>
        </div>
        <div className="quote">
          <p>{quote}</p>
        </div>
      </div>
    </div>
  );
}

export default function HomepageTestimonials() {
  return (
    <section className={styles.testimonialSection}>
      <div className={clsx("container", styles.testimonialContainer)}>
        <div className="row">
          <div className={clsx("col", styles.blocktextContainer)}>
            <div className={styles.blocktext}>
              <p>Use The&nbsp;Stack You&nbsp;Have</p>
            </div>
            <div>
              <TestimonialImage
                title="Coder sat at monitor"
                className={styles.testimonialImage}
              />
            </div>
          </div>
          <div className={clsx("col")}>
            {TestimonialList.map((props, idx) => (
              <Testimonial key={idx} {...props} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
