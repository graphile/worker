# Changesets notes

Create a release note with `yarn changeset`. Versioning is performed by the
release workflow through `yarn changeset-version`; this regenerates
`src/version.ts` and updates `CHANGELOG.md`. Changesets Action creates the
release commit and pull request.

Docs: https://github.com/changesets/changesets
