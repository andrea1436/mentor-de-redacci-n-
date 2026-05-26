import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API routes
  app.post("/api/evaluate", async (req, res) => {
    try {
      const { prompt, filePart } = req.body;

      const contents: any[] = [{ text: prompt }];
      if (filePart) {
        contents[0].parts = [
          { text: prompt },
          { inlineData: filePart.inlineData }
        ];
      }

      const responseSchema: any = {
        type: Type.OBJECT,
        properties: {
          nombreEstudiante: { type: Type.STRING },
          tituloEnsayo: { type: Type.STRING },
          grado: { type: Type.STRING },
          fecha: { type: Type.STRING },
          transcripcionExacta: { type: Type.STRING },
          observacionesDetalladas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                num: { type: Type.NUMBER },
                parrafo: { type: Type.STRING },
                linea: { type: Type.NUMBER },
                fragmento: { type: Type.STRING },
                categoria: { type: Type.STRING },
                errorIdentificado: { type: Type.STRING },
                explicacion: { type: Type.STRING },
                correccionSugerida: { type: Type.STRING }
              },
              required: ["num", "parrafo", "linea", "fragmento", "categoria", "errorIdentificado", "explicacion", "correccionSugerida"]
            }
          },
          resumenCategorias: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                categoria: { type: Type.STRING },
                cantidad: { type: Type.NUMBER }
              },
              required: ["categoria", "cantidad"]
            }
          },
          desempenoGlobal: { type: Type.STRING },
          justificacionGlobal: { type: Type.STRING },
          desglose: {
            type: Type.OBJECT,
            properties: {
              tesis: { type: Type.OBJECT, properties: { desempeno: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeno", "comentario"] },
              argumentacion: { type: Type.OBJECT, properties: { desempeno: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeno", "comentario"] },
              coherencia: { type: Type.OBJECT, properties: { desempeno: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeno", "comentario"] },
              estructura: { type: Type.OBJECT, properties: { desempeno: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeno", "comentario"] },
              ortografia: { type: Type.OBJECT, properties: { desempeno: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeno", "comentario"] }
            },
            required: ["tesis", "argumentacion", "coherencia", "estructura", "ortografia"]
          },
          analisisCriterios: {
            type: Type.OBJECT,
            properties: {
              ortografia_letras: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
              puntuacion: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
              estructura: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
              conectores: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
              claridad: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
              sustentacion: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] }
            },
            required: ["ortografia_letras", "puntuacion", "estructura", "conectores", "claridad", "sustentacion"]
          },
          recomendaciones: { type: Type.STRING },
          nivelEnsayo: { type: Type.STRING }
        },
        required: ["nombreEstudiante", "tituloEnsayo", "grado", "fecha", "transcripcionExacta", "observacionesDetalladas", "resumenCategorias", "desempenoGlobal", "justificacionGlobal", "desglose", "analisisCriterios", "recomendaciones", "nivelEnsayo"]
      };

      const systemInstruction = `Actúa como un Mentor Académico de la I.E. RETIRO DE LOS INDIOS (Grado 9) con capacidad de visión avanzada.
          Tu misión es evaluar ensayos de forma estrictamente CUALITATIVA usando: Superior (S), Alto (A), Básico (B), Bajo (BJ). 
          PROHIBIDO usar números o porcentajes en la valoración global.

          CAPACIDAD VISUAL AVANZADA Y DE COLOR (CRÍTICO):
          - El manuscrito puede presentar caligrafía CURSIVA (letra pegada), imprenta o una mezcla de ambas. DEBES procesar cada trazo con rigor, identificando letras estilizadas.
          - El estudiante puede haber usado LAPICERO ROJO u otros colores para recalcar tildes, puntos o letras. 
          - REGLA DE ORO: Si un signo (tilde, coma, punto) es visible en la imagen, sin importar su color o estilo caligráfico, DEBE ser considerado como presente en el texto.
          - Observa con detenimiento signos de puntuación minúsculos o trazos finos que podrían confundirse con el fondo del papel.

          REQUISITOS DE ANÁLISIS (RIGOR EXTREMO):
          1. PRECISIÓN EN TILDES Y CURSIVA: No marques como error una tilde que esté presente visualmente, aunque sea un trazo rápido en cursiva. Analiza minuciosamente las reglas de acentuación.
          2. PUNTUACIÓN Y ESTILO: Identifica puntos y comas incluso si están escritos de forma tenue o en colores (como rojo).
          3. MARCAS DE COLOR: Considera los elementos en color como parte integral y correcta del texto.
          4. NUMERACIÓN POR LÍNEAS: En 'transcripcionExacta', refleja fielmente el texto numerado línea por línea.
          5. REFERENCIA DE LÍNEA: Indica la LÍNEA EXACTA en cada observación.
          6. DOBLE CHEQUEO: Si el signo es perceptible visualmente, NO es un error de omisión. Evita falsos positivos a toda costa.
          7. EXHAUSTIVIDAD TOTAL: Debes identificar y reportar absolutamente TODOS los errores ortográficos (tildes, grafemas, mayúsculas), de puntuación, gramaticales y de sentido encontrados en el texto. No omitas ninguno por pequeño que sea. TODOS deben estar listados en 'observacionesDetalladas'.

          Para el "Análisis Detallado" por criterio (analisisCriterios), para cada uno de los 6 puntos debes:
          - Analizar profundamente el estado del texto.
          - Liste ejemplos específicos (citas) del ensayo.
          - Sugerir una ruta de mejora clara.

          Los 6 criterios son:
          1. Aspectos ortográficos: Énfasis total en Tildes (sin falsos positivos) y grafemas.
          2. Puntuación y mayúsculas: Énfasis en Comas, Puntos seguidos/aparte.
          3. Estructura: Tesis, Desarrollo, Conclusión.
          4. Conectores: Variedad lógica de nexos.
          5. Claridad: Coherencia y precisión léxica.
          6. Argumentación: Solidez de las evidencias.`;

      const contentsPayload = filePart ? [{ parts: [filePart, { text: prompt }] }] : [{ parts: [{ text: prompt }] }];

      const modelsToTry = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3-flash-preview"];
      let lastError: any = null;
      let responseText = "";

      for (const currentModel of modelsToTry) {
        let attempt = 0;
        const maxAttempts = 2;
        while (attempt < maxAttempts) {
          try {
            console.log(`[Evaluate API] Trying ${currentModel} (Attempt ${attempt + 1}/${maxAttempts})...`);
            const response = await ai.models.generateContent({
              model: currentModel,
              contents: contentsPayload,
              config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
              }
            });
            responseText = response.text || "";
            if (responseText) {
              console.log(`[Evaluate API] Success with model ${currentModel}`);
              break;
            }
          } catch (error: any) {
            attempt++;
            lastError = error;
            console.error(`[Evaluate API] Error on ${currentModel} (Attempt ${attempt}):`, error.message || error);
            if (attempt < maxAttempts) {
              console.log("[Evaluate API] Waiting before retrying...");
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        if (responseText) {
          break;
        }
      }

      if (!responseText) {
        throw lastError || new Error("All active models and retry attempts failed.");
      }

      res.json(JSON.parse(responseText));
    } catch (error: any) {
      console.error("Gemini Error:", error);
      res.status(500).json({ error: error.message || "Error interno del servidor al consultar Gemini." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
