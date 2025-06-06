# Release Process

## Release

1. `npm run ship:pre`
    - Runs the pre-release script:
        - Verifies you are on the main branch and have no uncommitted changes,
        - Pulls the latest changes from origin/main,
        - Checks for outdated dependencies,
        - Runs lint, clean, install/build, and tests,
        - Bumps the version in the root `package.json`
            - (default: prerelease, or use `--bump=minor` for a minor version bump).
    - You can use `--dry-run` or `-d` to preview the steps without making changes.
1. `cd packages/cli && npm i -g`
    - Installs the CLI globally from your local code.
1. `teams --version`
    - Verifies the installed CLI version matches the bumped version.
1. Test the CLI
    - Create a new temporary app and run it.
    - If CLI has been updated, test the new/updated commands.
1. `npm run dev --workspace=@tests/<app>`
    - Run an app from the `/tests` folder
    - Ensure the development/test apps work as expected.
1. `npx changeset add`
    - Select **all** @microsoft/teams/\* packages to include in the changeset. This will create a new changeset file in `.changeset/`.
1. Review the changeset file in `.changeset/`
    - Ensure it includes all necessary packages and changes.
1. `npm i`
    - Updates `package-lock.json` after the changeset.
1. `npx changeset version`
    - Applies the changeset, updating package versions and generating changelogs.
1. `npx changeset publish`
    - Publishes to npmjs.org.
1. `npm run ship:tag`
    - creates a main tag for all combined packages (`vX.x.x(-preview.X`))

## 🎉 Published! 🎉

## Finalizing the release

1. Make a new PR with changed files; should include:
    - New `.changeset/` files
    - Root `package.json` and `package-lock.json`
    - All updated `package.json` and `CHANGELOG.md` files for each released package
1. Go to the [GitHub Releases page](https://github.com/microsoft/teams.ts/releases) and create a new release using the tag created from running `ship:tag`. Also, use 'from last tag' to ensure the release notes are generated correctly.
1. Verify one or more of the packages on [npmjs.org](https://www.npmjs.com/) that version has been published. Sometimes caching issues may cause a delay.
1. [Optional] Make a new PR running `npm update --workspaces`
