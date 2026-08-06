"""
Prepare data for model training. Right now we have TrainingResourcesSnapshot, however we don't currently have the extracted 
features such as wpm. This file will create the data in a format that can be used to train a model by combining the TrainingResourcesSnapshot
and the extracted features.  
It is important that the features are normalised using z-score standardisation to achieve a mean of 0 and a standard 
deviation of 1.
Not sure if we need this file though, as this may be done elsewhere.
"""