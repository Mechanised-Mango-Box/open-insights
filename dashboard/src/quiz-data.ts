type Quiz = {
    questions: Array<Question>
}

interface Question {
    trigger: QuestionTrigger
}

interface QuestionTrigger { };
type TimestampTrigger = {
    timestamp: number;
}

type MCQ = Question & {
    text: string
    options: Array<MCQOption>
    allowMultipleOptions: boolean
}

type MCQOption = {
    label: string
    isCorret: boolean
}
/*
const sampleQuiz: Quiz = {
    questions: [
        {
            trigger: {
                timestamp: 10
            } as TimestampTrigger,
            text: "What is the meaning of life?",
            options: [
                { label: "Who knows...", isCorret: true },
                { label: "Wrong", isCorret: false },
                { label: "Wrong again!", isCorret: false },
                { label: "42", isCorret: true }
            ],
            allowMultipleOptions: false
        } as MCQ,

        {
            trigger: {
                timestamp: 25
            } as TimestampTrigger,
            text: "Select all fruits:",
            options: [
                { label: "Apple", isCorret: true },
                { label: "Orange", isCorret: true },
                { label: "Tomato", isCorret: true },
                { label: "Lettuce", isCorret: false }
            ],
            allowMultipleOptions: true
        } as MCQ
    ]
};
*/