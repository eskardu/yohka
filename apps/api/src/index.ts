import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { config } from "./config.js";
import { errorHandler } from "./errors.js";
import { router } from "./routes.js";

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", "data:", "https:"],
        "upgrade-insecure-requests": null
      }
    }
  })
);
app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin }));
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
