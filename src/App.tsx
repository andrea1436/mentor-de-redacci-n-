/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface FeedbackItem {
  error: string;
  sugerencia: string;
  explicacion: string;
  categoria: string;
}

interface EvaluationResult {
  saludo: string;
  retroalimentacion: FeedbackItem[];
  consejoOro: string;
  puntuacion: number;
  tituloAnalisis: string;
}

export default function App() {
  const [essay, setEssay] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    if (!essay.trim()) return;
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: essay }]
          }
        ],
        config: {
          systemInstruction: `Actúa como un Experto en Lingüística y Redacción Pedagógica, con una especialidad en el acompañamiento de estudiantes de secundaria (grado 7.º) en contextos rurales. Tu tono debe ser siempre cercano, motivador y empático, celebrando la identidad cultural del estudiante mientras corriges con precisión técnica.

OBJETIVO: Evaluar y proporcionar retroalimentación constructiva a ensayos cortos (máximo 3 párrafos o una hoja) escritos por estudiantes. Tu meta es mejorar la calidad textual sin desincentivar la expresión libre del alumno.

CONTEXTO:
- Audiencia: Estudiantes de la Institución Educativa Retiro de los Indios (Cereté, Córdoba).
- Temática: Identidad cultural, tradiciones y relatos locales.
- Restricciones: Los estudiantes tienen libertad de lenguaje (pueden usar regionalismos), pero deben aprender a estructurarlos formalmente.

DELIMITADORES DE SEGURIDAD:
- Solo evalúa textos que parezcan ensayos o relatos. 
- Si el texto no tiene sentido o no es un ensayo/relato, usa el campo 'saludo' para pedir amablemente al estudiante que intente explicar su idea de nuevo o que escriba sobre sus tradiciones, y deja 'retroalimentacion' como una lista vacía.

ACCIONES:
1. Lee el ensayo completo e identifica el tema cultural principal.
2. Analiza la Estructura: ¿Tiene introducción, desarrollo y conclusión?
3. Revisa la Gramática y Ortografía: Detecta errores de tildes, mayúsculas y puntuación.
4. Evalúa la Coherencia y Cohesión: ¿Las ideas fluyen o están aisladas?
5. Mitigación de sesgos: No penalices el uso de palabras locales o dialectos; en su lugar, sugiere cómo integrarlos en un texto académico.

SALIDA (JSON):
- tituloAnalisis: Un título corto y motivador para el análisis (ej: "Un relato con alma", "Tradición vibrante").
- saludo: Un breve comentario (máx. 80 palabras) que resalte algo positivo del contenido o la historia que el estudiante contó. Si el texto no es válido, úsalo para orientar al estudiante.
- retroalimentacion: Una lista de objetos con 'error', 'sugerencia', 'explicacion' y 'categoria' (ej: "Ortografía", "Concordancia", "Vocabulario").
- consejoOro: Una sugerencia final para mejorar la estructura del ensayo de forma sencilla.
- puntuacion: Una puntuación estimada del 1 al 100 basada en el nivel esperado para grado 7.º.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tituloAnalisis: { type: Type.STRING },
              saludo: { type: Type.STRING },
              retroalimentacion: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    error: { type: Type.STRING },
                    sugerencia: { type: Type.STRING },
                    explicacion: { type: Type.STRING },
                    categoria: { type: Type.STRING }
                  },
                  required: ["error", "sugerencia", "explicacion", "categoria"]
                }
              },
              consejoOro: { type: Type.STRING },
              puntuacion: { type: Type.NUMBER }
            },
            required: ["tituloAnalisis", "saludo", "retroalimentacion", "consejoOro", "puntuacion"]
          }
        }
      });

      const text = response.text;
      if (text) {
        setResult(JSON.parse(text));
      }
    } catch (err) {
      console.error("Error evaluating essay:", err);
      setError("Lo siento, hubo un problema al evaluar tu ensayo. Por favor, intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen selection:bg-secondary-container selection:text-on-secondary-container">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 bg-surface/70 backdrop-blur-md flex justify-between items-center px-6 py-4 border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary">menu_book</span>
          <span className="font-headline text-xl font-bold tracking-tighter text-primary">Atheneum Editorial</span>
        </div>
        <div className="flex items-center gap-6">
          <nav className="hidden md:flex gap-8 items-center">
            <a className="font-label text-[13px] font-semibold uppercase tracking-wider text-on-background/60 hover:text-primary transition-colors" href="#">Biblioteca</a>
            <a className="font-label text-[13px] font-semibold uppercase tracking-wider text-on-background/60 hover:text-primary transition-colors" href="#">Lienzo</a>
            <a className="font-label text-[13px] font-semibold uppercase tracking-wider text-primary font-bold" href="#">Revisión</a>
            <a className="font-label text-[13px] font-semibold uppercase tracking-wider text-on-background/60 hover:text-primary transition-colors" href="#">Mentor</a>
          </nav>
          <span className="material-symbols-outlined text-primary cursor-pointer">account_circle</span>
        </div>
      </header>

      <main className="pt-24 pb-32 px-4 max-w-5xl mx-auto">
        {/* Editorial Header Section */}
        <section className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <span className="font-label text-primary font-bold uppercase tracking-[0.2em] text-[10px] mb-2 block">Sesión de Revisión</span>
            <h1 className="font-headline text-5xl md:text-6xl font-extrabold tracking-tighter text-on-background">Retroalimentación</h1>
          </div>
          <div className="text-right">
            <p className="font-label text-sm text-outline font-medium italic">Institución Educativa Retiro de los Indios</p>
            <p className="font-label text-xs text-outline/60">{new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </section>

        {/* Input Section */}
        {!result && (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-16"
          >
            <div className="bg-surface-container-lowest canvas-shadow rounded-xl p-8 md:p-12 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full satin-gradient"></div>
              <h2 className="font-headline text-2xl font-bold mb-6 text-primary">Comparte tu historia</h2>
              <textarea
                value={essay}
                onChange={(e) => setEssay(e.target.value)}
                placeholder="Escribe aquí tu ensayo sobre tradiciones, relatos locales o identidad cultural..."
                className="input-field min-h-[300px] mb-6"
                disabled={loading}
              />
              <div className="flex justify-end">
                <button
                  onClick={handleEvaluate}
                  disabled={loading || !essay.trim()}
                  className="px-8 py-3 satin-gradient text-on-primary rounded-lg font-label font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="material-symbols-outlined animate-spin">sync</span>
                      Analizando...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined">send</span>
                      Enviar para revisión
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.section>
        )}

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-8 bg-error/10 border border-error/20 text-error p-4 rounded-xl flex items-start gap-3"
            >
              <span className="material-symbols-outlined">error</span>
              <p className="font-label text-sm font-medium">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Section */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-16"
            >
              {/* Mentor's Warm Note */}
              <section>
                <div className="bg-surface-container-lowest canvas-shadow rounded-xl p-8 md:p-12 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full satin-gradient"></div>
                  <div className="flex items-start gap-6">
                    <div className="hidden sm:block">
                      <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center">
                        <span className="material-symbols-outlined text-secondary text-3xl">school</span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <h2 className="font-headline text-2xl font-bold mb-4 text-primary">{result.tituloAnalisis}</h2>
                      <div className="space-y-4 text-lg leading-relaxed text-on-surface italic">
                        <p>{result.saludo}</p>
                      </div>
                      <div className="mt-8 flex gap-3">
                        <span className="px-4 py-1.5 bg-secondary-container text-on-secondary-container rounded-full text-xs font-label font-bold uppercase tracking-wide">Progreso Académico</span>
                        <span className="px-4 py-1.5 bg-tertiary-container text-on-tertiary-container rounded-full text-xs font-label font-bold uppercase tracking-wide">Identidad Cultural</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Pedagogical Table */}
              <section className="space-y-6">
                <div className="flex items-center justify-between px-2">
                  <h3 className="font-headline text-xl font-bold tracking-tight">Desglose de Sugerencias</h3>
                  <div className="h-px flex-1 mx-6 bg-outline-variant/20 hidden sm:block"></div>
                </div>
                <div className="overflow-hidden bg-surface-container rounded-xl border border-outline-variant/10">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-container-high">
                          <th className="p-6 font-label text-xs font-bold uppercase tracking-widest text-outline">Error detectado</th>
                          <th className="p-6 font-label text-xs font-bold uppercase tracking-widest text-outline">Sugerencia</th>
                          <th className="p-6 font-label text-xs font-bold uppercase tracking-widest text-outline">¿Por qué?</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/20">
                        {result.retroalimentacion.map((item, idx) => (
                          <tr key={idx} className="hover:bg-surface-container-low transition-colors group">
                            <td className="p-6 align-top">
                              <div className="flex flex-col gap-2">
                                <span className="text-error font-body font-bold italic">"{item.error}"</span>
                                <span className="text-[10px] font-label text-outline bg-surface-container-high px-2 py-0.5 rounded w-fit uppercase">{item.categoria}</span>
                              </div>
                            </td>
                            <td className="p-6 align-top">
                              <span className="text-secondary font-body font-bold">"{item.sugerencia}"</span>
                            </td>
                            <td className="p-6 align-top">
                              <p className="font-body text-sm text-on-surface-variant leading-relaxed">
                                {item.explicacion}
                              </p>
                            </td>
                          </tr>
                        ))}
                        {result.retroalimentacion.length === 0 && (
                          <tr>
                            <td colSpan={3} className="p-12 text-center">
                              <span className="material-symbols-outlined text-secondary text-5xl mb-4">verified</span>
                              <p className="font-body text-on-surface-variant italic">¡Excelente! No se encontraron errores técnicos. Tu texto fluye maravillosamente.</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* Final CTA / Bento Decoration */}
              <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 bg-surface-container-low p-8 rounded-xl border border-outline-variant/10 flex flex-col justify-between">
                  <div>
                    <h4 className="font-headline text-xl font-bold mb-2">Consejo de Oro</h4>
                    <p className="font-body text-on-surface-variant italic mb-6">{result.consejoOro}</p>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <button 
                      onClick={() => {
                        setResult(null);
                        setEssay("");
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="px-8 py-3 satin-gradient text-on-primary rounded-lg font-label font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined">edit</span>
                      Nueva Revisión
                    </button>
                  </div>
                </div>
                <div className="bg-primary-container p-8 rounded-xl text-on-primary-container relative overflow-hidden flex flex-col justify-center">
                  <div className="absolute -right-4 -bottom-4 opacity-10">
                    <span className="material-symbols-outlined text-[120px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_stories</span>
                  </div>
                  <p className="font-label text-xs font-bold uppercase tracking-[0.3em] mb-4">Puntuación Estimada</p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-headline text-6xl font-extrabold tracking-tighter">{result.puntuacion}</span>
                    <span className="font-headline text-2xl opacity-60">/ 100</span>
                  </div>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* BottomNavBar */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center h-20 px-4 pb-safe bg-surface z-50 border-t border-outline-variant/20 shadow-[0px_-4px_16px_rgba(28,28,25,0.04)]">
        <a className="flex flex-col items-center justify-center text-on-background/50" href="#">
          <span className="material-symbols-outlined">auto_stories</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Biblioteca</span>
        </a>
        <a className="flex flex-col items-center justify-center text-on-background/50" href="#">
          <span className="material-symbols-outlined">edit_note</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Lienzo</span>
        </a>
        <a className="flex flex-col items-center justify-center text-primary bg-secondary-container/20 rounded-xl px-4 py-1" href="#">
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>forum</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Revisión</span>
        </a>
        <a className="flex flex-col items-center justify-center text-on-background/50" href="#">
          <span className="material-symbols-outlined">school</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Mentor</span>
        </a>
      </nav>
    </div>
  );
}
