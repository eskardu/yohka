import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { config } from "./config.js";
import { errorHandler } from "./errors.js";
import { router } from "./routes.js";

const app = express();

app.set("json replacer", (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'", "https://telegram.org"],
        "img-src": ["'self'", "data:", "https:"],
        "frame-ancestors": ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
        "upgrade-insecure-requests": null
      }
    }
  })
);
app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin }));
const uploadDir = process.env.UPLOAD_DIR ?? path.resolve("uploads");
app.use("/uploads", express.static(uploadDir, { maxAge: "30d", immutable: true }));
app.use(
  "/api/admin/uploads",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp", "application/octet-stream"], limit: "8mb" })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use(router);

const webappDistPath = process.env.WEBAPP_DIST_PATH;

if (webappDistPath) {
  app.use(express.static(webappDistPath));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api")) {
      next();
      return;
    }

    response.sendFile(path.join(webappDistPath, "index.html"));
  });
}

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
