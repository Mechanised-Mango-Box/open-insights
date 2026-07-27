-- Creating a TABLE for videos 
-- the variables/coloumns we need are video_id, youtube_url, duration_min, word_count, wpm, scene_count, scene_rate, uploader_opt_in

CREATE TABLE videos (
    video_id        INT PRIMARY KEY,
    youtube_url     VARCHAR(50),
    duration_min    INTEGER,
    word_count      INTEGER,
    wpm             REAL,
    scene_count     INTEGER,
    uploader_opt_in INTEGER -- i guess this is binary yes or no   
);

DESC videos;