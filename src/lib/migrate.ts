import {
  copyFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "fs";
import ora from "ora";
import { basename, join, resolve } from "path";
import { ProjectValidator, logger, runCMD } from "../utils/index.js";
import { select } from "@inquirer/prompts";
import { Command } from "commander";

const supportedMigrations = ["cra-to-vite"] as const;

type SupportedMigration = (typeof supportedMigrations)[number];

export function generateMigrateCmd() {
  return new Command("migrate")
    .description("Migrate project")
    .requiredOption("-p, --path <VALUE>", "Path to codebase")
    .option("-t, --type <VALUE>", "Type of migration")
    .showHelpAfterError()
    .action((args) => {
      const options = args as MigrationOptions;

      handleMigration(options);
    });
}

export async function handleMigration(options: MigrationOptions) {
  const { type, path } = options;

  const hasMigrationType = typeof type === "string";

  let choice = type;

  if (!hasMigrationType) {
    choice = await select({
      message: "Select migration type",
      choices: supportedMigrations.map((type) => ({
        value: type
      }))
    });
  }

  const isSupportedMigration = supportedMigrations.includes(
    type?.toString().toLowerCase() as SupportedMigration
  );

  if (!isSupportedMigration && hasMigrationType) {
    logger.error(`"${type}" is not supported yet\n`);

    choice = await select({
      message: "Select migration type",
      choices: supportedMigrations.map((type) => ({
        value: type
      }))
    });
  }

  switch (choice as SupportedMigration) {
    case "cra-to-vite":
      CRAToVite(path);
      break;

    default:
      break;
  }
}

export async function CRAToVite(path: MigrationOptions["path"]) {
  const fullPath = resolve(path);

  ProjectValidator.isCRAProject(fullPath);

  const isTsProj = existsSync(join(fullPath, "tsconfig.json"));
  const project = basename(fullPath);

  logger.info(`[!] Migrating ${project} to Vite`);

  const spinner = ora("Uninstalling react-scripts").start();

  spinner.color = "green";

  await runCMD({
    cwd: fullPath,
    args: ["remove", "react-scripts"]
  });

  spinner.succeed("Uninstalled react-scripts");
  spinner.stop();

  spinner.text = "Installing vite";
  spinner.start();

  await runCMD({
    cwd: fullPath,
    args: [
      "add",
      "vite",
      "@vitejs/plugin-react",
      isTsProj ? "vite-tsconfig-paths" : ""
    ]
  });

  spinner.succeed("Installed vite");
  spinner.stop();

  spinner.text = "Restructring project";
  spinner.start();

  try {
    const jsFiles = ["index.js", "App.js"];

    if (!isTsProj) {
      for (let file of jsFiles) {
        const filePath = join(fullPath, "src", file);

        if (existsSync(filePath)) {
          copyFileSync(filePath, filePath.replace(".js", ".jsx"));

          unlinkSync(filePath);
        }
      }
    }

    let data = readFileSync(join(fullPath, "public/index.html"), "utf8");

    data = data.replaceAll("%PUBLIC_URL%", "");

    const splitData = data.split(`<div id="root"></div>`);

    data = `${splitData[0]}
			<div id="root"></div>
		  <script type="module" src="/src/index.${isTsProj ? "ts" : "js"}x"></script>
		  ${splitData[1]}
		`;

    writeFileSync(join(fullPath, "index.html"), data);

    unlinkSync(join(fullPath, "public/index.html"));

    spinner.succeed("Restructured project");
    spinner.stop();
  } catch (err) {
    if (err instanceof Error) {
      spinner.fail(err.message);
      spinner.stop();
    }
  }

  spinner.text = "Writting Vite config";
  spinner.start();

  const hasTailwindCSS = existsSync(join(fullPath, "tailwind.config.js"));

  const viteConfig = `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
${hasTailwindCSS ? "import tailwindcss from 'tailwindcss';" : ""}

export default defineConfig(() => {
  return {
    plugins: [react()],
    ${hasTailwindCSS ? "css: { postcss: { plugins: [tailwindcss()] } }," : ""}
  };
});`;

  try {
    writeFileSync(join(fullPath, "vite.config.js"), viteConfig);

    if (isTsProj) {
      writeFileSync(
        join(fullPath, "vite-env.d.ts"),
        `/// <reference types="vite/client" />`
      );
    }

    spinner.succeed("Written Vite config");
    spinner.stop();
  } catch (err) {
    if (err instanceof Error) {
      spinner.fail(err.message);
      spinner.stop();
    }
  }

  spinner.text = "Updating package.json";
  spinner.start();

  try {
    const data = readFileSync(join(fullPath, "package.json"), "utf8");

    const jsonData = JSON.parse(data);

    jsonData["scripts"] = {
      dev: "vite",
      build: "vite build",
      serve: "vite preview"
    };

    writeFileSync(
      join(fullPath, "package.json"),
      JSON.stringify(jsonData, null, 4)
    );

    spinner.succeed("Updated package.json");
    spinner.stop();
  } catch (err) {
    if (err instanceof Error) {
      spinner.fail(err.message);
      spinner.stop();
    }
  }

  if (isTsProj) {
    spinner.text = "Updating tsconfig.json";
    spinner.start();

    try {
      const data = readFileSync(join(fullPath, "tsconfig.json"), "utf8");

      const jsonData = JSON.parse(data);

      jsonData["compilerOptions"]["types"] = [
        ...jsonData["compilerOptions"]["types"],
        "vite/client"
      ];

      writeFileSync(
        join(fullPath, "tsconfig.json"),
        JSON.stringify(jsonData, null, 4)
      );

      spinner.succeed("Updated tsconfig.json");
      spinner.stop();
    } catch (err) {
      if (err instanceof Error) {
        spinner.fail(err.message);
        spinner.stop();
      }
    }
  }
}
