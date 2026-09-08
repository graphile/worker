# Changesets notes

Create a release note with `yarn changeset`. Versioning is performed by the
release workflow through `yarn changeset-version`; this regenerates
`src/version.ts`, updates `CHANGELOG.md`, and commits the release changes. This
is all handled automatically by the CI release process.

Docs: https://github.com/changesets/changesets
