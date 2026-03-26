import { useState } from "react";
import { createCheckpoint } from "../../api";

type Props = {
  classVideoId: number;
};

const QuizEditor = ({ classVideoId }: Props) => {
  const [timestamp, setTimestamp] = useState(30);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([
    { option_text: "", is_correct: true },
    { option_text: "", is_correct: false },
    { option_text: "", is_correct: false },
    { option_text: "", is_correct: false },
  ]);

  const updateOption = (index: number, value: string) => {
    const next = [...options];
    next[index].option_text = value;
    setOptions(next);
  };

  const setCorrectIndex = (index: number) => {
    setOptions(options.map((o, i) => ({
      ...o,
      is_correct: i === index
    })));
  };

  const handleSave = async () => {
    await createCheckpoint({
      class_video_id: classVideoId,
      timestamp_seconds: Number(timestamp),
      question_text: question,
      options,
    });

    setTimestamp(30);
    setQuestion("");
    setOptions([
      { option_text: "", is_correct: true },
      { option_text: "", is_correct: false },
      { option_text: "", is_correct: false },
      { option_text: "", is_correct: false },
    ]);
  };

  return (
    <div>
      <h4>Add Quiz Checkpoint</h4>
      <input
        type="number"
        value={timestamp}
        onChange={(e) => setTimestamp(Number(e.target.value))}
        placeholder="Timestamp in seconds"
      />
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Question text"
      />
      {options.map((opt, i) => (
        <div key={i}>
          <input
            value={opt.option_text}
            onChange={(e) => updateOption(i, e.target.value)}
            placeholder={`Option ${i + 1}`}
          />
          <label>
            <input
              type="radio"
              checked={opt.is_correct}
              onChange={() => setCorrectIndex(i)}
            />
            Correct
          </label>
        </div>
      ))}
      <button onClick={handleSave}>Save Question</button>
    </div>
  );
};

export default QuizEditor;
