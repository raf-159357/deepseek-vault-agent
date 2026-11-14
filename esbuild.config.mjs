import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const banner = `/*
DeepSeek Vault Agent — built ${new Date().toISOString()}
个人自用插件，未发布到 Obsidian 社区市场。
*/`;

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", "@codemirror/language", "@lezer/common", "@lezer/highlight"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	await context.dispose();
	console.log("built main.js");
	process.exit(0);
} else {
	await context.watch();
}
