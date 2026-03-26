import { useState } from "react";
import { createClass } from "../../api";

type Props = {
  teacherId: number;
  onCreated: () => void;
};

const CreateClass = ({ teacherId, onCreated }: Props) => {
  const [name, setName] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createClass({ name, teacher_id: teacherId });
    setName("");
    onCreated();
  };

  return (
    <div>
      <h3>Create Class</h3>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="FIT2004"
      />
      <button onClick={handleCreate}>Create</button>
    </div>
  );
};

export default CreateClass;

