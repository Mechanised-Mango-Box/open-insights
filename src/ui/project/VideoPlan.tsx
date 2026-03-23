const VideoPlan = () => {
  return (
    <div>
      <h1>Video Plan</h1>

      <section>
        <h2>Settings</h2>
        <label>
          Project Name:
          <input type="text" placeholder="Enter project name" />
        </label>
      </section>

      <section>
        <h2>Sources</h2>
        <label>
          Video Link/ID:
          <input type="text" placeholder="Paste video link or ID" />
        </label>
        <button>Update Data</button>
      </section>

      <section>
        <h2>Meta</h2>
        <p>
          <label>
            Video Type:
            <select>
              <option value="">Select type</option>
              <option value="lecture">Lecture</option>
              <option value="demo">Demonstration</option>
            </select>
          </label>
        </p>
        <p>
          <label>
            Video Style:
            <select>
              <option value="">Select style</option>
              <option value="head">Talking Head</option>
              <option value="tutorial">Tutorial</option>
            </select>
          </label>
        </p>
      </section>
    </div>
  );
};

export default VideoPlan;
