export enum AnswerStatus {
  UNANSWERED,
  CORRECT,
  INCORRECT,
}

// State for a single question during an active quiz
export interface QuestionState {
  id: string;
  question: string;
  answer: string;
  source_questions: string;
  isRevealed: boolean;
  status: AnswerStatus;
}

// The template for a quiz question, as stored
export interface QuizQuestion {
  id: string;
  question: string;
  answer: string;
  source_questions: string;
}

// Record of a single quiz attempt
export interface QuizAttempt {
  date: number; // Store as timestamp
  answers: AnswerStatus[];
}

// The main record for an uploaded PDF
export interface PdfRecord {
  id: string;
  fileName: string;
  displayName: string;
  summary: string;
  quiz: QuizQuestion[];
  quizAttempts: QuizAttempt[];
  createdAt: number;
}


export interface GeminiQuizResponse {
  summary: string;
  quiz: {
    question: string;
    answer: string;
    source_questions: string;
  }[];
}

// Make pdfjsLib available on the window object
declare global {
    interface Window {
        pdfjsLib: any;
    }
}