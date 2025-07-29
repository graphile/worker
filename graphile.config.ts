import type {} from "graphile-worker";

const MyMigrationPlugin: GraphileConfig.Plugin = {
  name: "MyMigrationPlugin",
  worker: {
    middleware: {
      async migrate(next, _event) {
        const result = await next();

        // Do your stuff here.

        return result;
      },
    },
  },
};

const preset: GraphileConfig.Preset = {
  plugins: [MyMigrationPlugin],
  worker: {},
};

export default preset;
