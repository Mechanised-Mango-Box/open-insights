console.log("EXTENSION LOADED")

let quiz_shown = false
function time_check() {
    const video = document.querySelector('video')
    console.log(video)
    console.log(video.currentTime)
    
    if (video.currentTime >= 10 && quiz_shown === false) {
        quiz_shown = true
        video.pause()
    }
}

const intervalID = setInterval(time_check, 1000) ;
