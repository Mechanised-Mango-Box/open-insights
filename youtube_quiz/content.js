console.log("EXTENSION LOADED")

let quiz_shown = false
function time_check() {
    const video = document.querySelector('video')
    console.log(video)
    console.log(video.currentTime)
    
    if (video.currentTime >= 10 && quiz_shown === false) {
        console.log("QUIZ TRIGGERED")
        quiz_shown = true
        video.pause()
        overlay()
        clearInterval(intervalID)
    }
}

const intervalID = setInterval(time_check, 1000) ;

// creating an overlay to show a popup
function overlay() {
    console.log("OVERLAY CALLED")
    const div = document.createElement('div')
    div.textContent = "What is 2 + 2?"  

    //making the text bigger
    // STYLE THE OVERLAY
    div.style.position = "absolute"
    div.style.top = "50%"
    div.style.left = "50%"
    div.style.transform = "translate(-50%, -50%)"
    div.style.backgroundColor = "rgba(0, 0, 0, 0.8)"
    div.style.color = "white"
    div.style.padding = "20px"
    div.style.fontSize = "30px"
    div.style.textAlign = "center"
    div.style.zIndex = "9999"
    div.style.borderRadius = "10px"

    const player = document.querySelector('#movie_player')
    player.appendChild(div)

    const button = document.createElement('button')
    button.textContent = "Option A"
    button.style.display = "block"
    button.style.margin = "10px auto"
    button.style.fontSize = "20px"
    div.appendChild(button)  

    const buttonB = document.createElement('button')
    buttonB.textContent = "Option B"
    buttonB.style.display = "block"
    buttonB.style.margin = "10px auto"
    buttonB.style.fontSize = "20px"
    div.appendChild(buttonB)


}