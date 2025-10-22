
import { GoogleGenAI, Type } from "@google/genai";
import { GeminiQuizResponse } from '../types';

const API_KEY = import.meta.env.VITE_API_KEY;

if (!API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const quizGenerationSchema = {
    type: Type.OBJECT,
    properties: {
        summary: {
            type: Type.STRING,
            description: "A comprehensive summary of the document, detailed enough for recall.",
        },
        quiz: {
            type: Type.ARRAY,
            description: "An array of 20-25 quiz questions.",
            items: {
                type: Type.OBJECT,
                properties: {
                    question: {
                        type: Type.STRING,
                        description: "The quiz question.",
                    },
                    answer: {
                        type: Type.STRING,
                        description: "The concise and accurate answer to the question.",
                    },
                    source_questions: {
                        type: Type.STRING,
                        description: "A reference to which original questions from the 'questões comentadas' section of the PDF inspired this quiz question. Example: 'Baseado nas questões 5 e 12'.",
                    },
                },
                required: ["question", "answer", "source_questions"],
            },
        },
    },
    required: ["summary", "quiz"],
};

export const generateQuizAndSummaryFromText = async (pdfText: string): Promise<GeminiQuizResponse> => {
    try {
        const prompt = `
            Você é um assistente de estudos especialista em concursos públicos. Sua tarefa é analisar o texto de um PDF de material de estudo e criar um quiz focado nos tópicos mais relevantes para provas, ignorando conteúdo introdutório.

            **MISSÃO PRINCIPAL: CRIAR UM QUIZ ESTRATÉGICO**
            1.  **FOCO ABSOLUTO NAS QUESTÕES COMENTADAS:** Sua análise para o quiz deve se concentrar **exclusivamente** na seção do PDF intitulada "Questões Comentadas" ou similar, que geralmente se encontra nas páginas finais. Ignore todo o conteúdo teórico inicial e introdutório para a criação das perguntas. A base para o quiz são as questões que já caíram em provas e suas resoluções.
            2.  **IDENTIFIQUE OS PADRÕES DE COBRANÇA:** Dentro da seção de "Questões Comentadas", identifique os conceitos, artigos de lei, e temas que são cobrados repetidamente. Qual é o 'coração' da matéria que as bancas examinadoras mais cobram, de acordo com essas questões?
            3.  **ELABORE O QUIZ:** Crie um quiz de 20 a 25 perguntas que simulem a cobrança desses temas mais frequentes. As perguntas devem ser diretas e no estilo de prova.
            4.  **RASTREIE A ORIGEM:** Para cada pergunta do quiz, é mandatório que você indique em qual(is) questão(ões) comentada(s) do PDF você se baseou. Preencha o campo 'source_questions' com essa informação (ex: "Inspirado nas questões 7 e 15 da seção de comentários").

            **MISSÃO SECUNDÁRIA: CRIAR UM RESUMO**
            Apenas para o resumo, você pode usar o texto completo do PDF. Crie um "resumão" que sirva para uma revisão rápida do conteúdo geral.

            **REGRAS DE SAÍDA:**
            - A resposta deve ser um objeto JSON puro, sem formatação extra.
            - Siga estritamente o schema JSON fornecido.

            Texto do PDF para Análise:
            ---
            ${pdfText}
            ---
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: quizGenerationSchema,
            },
        });
        
        const jsonText = response.text;
        const parsedData = JSON.parse(jsonText);

        // Basic validation
        if (!parsedData.summary || !Array.isArray(parsedData.quiz) || !parsedData.quiz.every((q: any) => q.source_questions)) {
            throw new Error("Invalid data structure received from API");
        }

        return parsedData;

    } catch (error) {
        console.error("Error generating quiz from Gemini:", error);
        throw new Error("Failed to generate quiz. Please try again with a different PDF.");
    }
};


const singleQuestionGenerationSchema = {
    type: Type.OBJECT,
    properties: {
        question: {
            type: Type.STRING,
            description: "A clear and concise quiz question based on the provided text.",
        },
        answer: {
            type: Type.STRING,
            description: "The correct answer to the generated question.",
        },
    },
    required: ["question", "answer"],
};

export const generateSingleQuestionFromText = async (textSnippet: string): Promise<{question: string, answer: string}> => {
    try {
        const prompt = `
            Você é um assistente de estudos. Sua única tarefa é criar UMA pergunta de quiz e UMA resposta com base no texto fornecido.
            A pergunta deve ser clara e diretamente relacionada ao conteúdo do texto.
            A resposta deve ser precisa e concisa.

            **REGRAS DE SAÍDA:**
            - A resposta deve ser um objeto JSON puro, sem formatação extra.
            - Siga estritamente o schema JSON fornecido.

            Texto para Análise:
            ---
            ${textSnippet}
            ---
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: singleQuestionGenerationSchema,
            },
        });
        
        const jsonText = response.text;
        const parsedData = JSON.parse(jsonText);

        // Basic validation
        if (!parsedData.question || !parsedData.answer) {
            throw new Error("Invalid data structure received from API for single question");
        }

        return parsedData;

    } catch (error) {
        console.error("Error generating single question from Gemini:", error);
        throw new Error("Failed to generate question from text. Please try again.");
    }
};
